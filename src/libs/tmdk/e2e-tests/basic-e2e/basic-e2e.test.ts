// Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { getDefaultAwsClients as aws, initDefaultAwsClients } from '../../src/lib/aws-clients';
import { Arguments } from 'yargs';
import * as deploy from '../../src/commands/deploy';
import * as init from '../../src/commands/init';
import * as nuke from '../../src/commands/nuke';
import * as fs from 'fs';
import * as constants from './basic-e2e-constants';
import { twinMakerAssumeRolePolicy, twinMakerPermissionPolicy, twinMakerPermissionPolicySuffix } from './basic-e2e-iam';
import { ComponentTypeSummary, GetComponentTypeCommandOutput } from '@aws-sdk/client-iottwinmaker';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as path from 'path';
import { EntitySummary } from '@aws-sdk/client-iottwinmaker/dist-types/models/models_0';
import { delay } from '../../src/lib/utils';
const prompts = require('prompts');

// Ensure nuke always operates
prompts.inject(['Y', 'Y']);

test('basic e2e test', async () => {
  console.log('//////      BEGIN BASIC E2E TEST     //////');
  let argv2: any;

  // 0. Get account info
  console.log('Initializing AWS client.');
  initDefaultAwsClients({ region: `${constants.region}` });
  const accountId = (await aws().getCurrentIdentity())['accountId'];
  const twinMakerRoleName = constants.workspaceId + '-' + accountId + '-role';
  const twinMakerPolicyName = twinMakerRoleName + twinMakerPermissionPolicySuffix;
  const twinMakerRoleArn = 'arn:aws:iam::' + accountId + ':role/' + twinMakerRoleName;
  const workspaceS3BucketName = constants.workspaceId + '-' + accountId;
  const workspaceS3BucketArn = 'arn:aws:s3:::' + workspaceS3BucketName;
  const scene1S3Location = 's3://' + workspaceS3BucketName + '/' + constants.scene1FileName;
  const model1S3Location = 's3://' + workspaceS3BucketName + '/' + constants.model1FileName;
  const model2S3Location = 's3://' + workspaceS3BucketName + '/' + constants.model2FileName;

  // 1. Clean up pre-existing resources, if any
  console.log('Deleting test IAM role, s3 bucket, and workspace if they exist.');
  try {
    await aws().tm.getWorkspace({ workspaceId: constants.workspaceId });
    console.log('Workspace exists, nuking it.');
    argv2 = {
      _: [ 'nuke' ],
      '$0': 'tmdk_local',
      region: 'us-east-1',
      'workspace-id': constants.workspaceId
    } as Arguments<nuke.Options>;
    try {await nuke.handler(argv2);} catch (e) {}
    await aws().tm.deleteWorkspace({ workspaceId: constants.workspaceId });
  } catch (e) {}
  try {
    await aws().s3.send(new DeleteObjectCommand({ Bucket: workspaceS3BucketName, Key: constants.model1FileName }));
    await aws().s3.send(new DeleteObjectCommand({ Bucket: workspaceS3BucketName, Key: constants.model2FileName }));
    await aws().s3.send(new DeleteObjectCommand({ Bucket: workspaceS3BucketName, Key: constants.scene1FileName }));
    await aws().s3.send(new DeleteObjectCommand({ Bucket: workspaceS3BucketName, Key: constants.scene2FileName }));
    await aws().s3.deleteBucket({ Bucket: workspaceS3BucketName });
  } catch (e) {}
  try {
    await aws().iam.deleteRolePolicy({ RoleName: twinMakerRoleName, PolicyName: twinMakerPolicyName });
  } catch (e) {}
  try {
    await aws().iam.deleteRole({ RoleName: twinMakerRoleName });
  } catch (e) {}

  // 2. Set up test resources
  try {
    console.log('Creating IAM role: ' + twinMakerRoleName);
    await aws().iam.createRole({
      RoleName: twinMakerRoleName,
      AssumeRolePolicyDocument: JSON.stringify(twinMakerAssumeRolePolicy)
    });
    let twinMakerPolicyString = JSON.stringify(twinMakerPermissionPolicy);
    twinMakerPolicyString = twinMakerPolicyString.replace('s3ArnStar', workspaceS3BucketArn + '/*');
    twinMakerPolicyString = twinMakerPolicyString.replace('s3ArnStandard', workspaceS3BucketArn);
    twinMakerPolicyString = twinMakerPolicyString.replace('s3ArnDelete',
      workspaceS3BucketArn + '/DO_NOT_DELETE_WORKSPACE_*');
    await aws().iam.putRolePolicy({
      RoleName: twinMakerRoleName,
      PolicyName: twinMakerPolicyName,
      PolicyDocument: twinMakerPolicyString
    });
    await delay(10000); // allow role to propagate
    console.log('Creating workspace bucket: ' + workspaceS3BucketName);
    await aws().s3.createBucket({
      Bucket: workspaceS3BucketName
    });
    console.log('Creating workspace: ' + constants.workspaceId);
    await aws().tm.createWorkspace({
      workspaceId: constants.workspaceId,
      s3Location: workspaceS3BucketArn,
      role: twinMakerRoleArn
    });
    console.log('Uploading scene 1 definition file to s3 bucket: ' + workspaceS3BucketName);
    let scene1Definition = JSON.parse(fs.readFileSync(path.join(constants.localResourcesDir, constants.scene1FileName),
      constants.jsonEncoding));
    scene1Definition['nodes'][0]['components'][0]['uri'] = model1S3Location;
    const scene1UploadParams = {
      Bucket: workspaceS3BucketName,
      Key: constants.scene1FileName,
      Body: JSON.stringify(scene1Definition)
    };
    await aws().s3.send(new PutObjectCommand(scene1UploadParams));
    constants.scene1Input['contentLocation'] = scene1S3Location;
    console.log('Uploading model 1 glb file to s3 bucket: ' + workspaceS3BucketName);
    const model1UploadParams = {
      Bucket: workspaceS3BucketName,
      Key: constants.model1FileName,
      Body: fs.createReadStream(path.join(constants.localResourcesDir, constants.model1FileName))
    };
    await aws().s3.send(new PutObjectCommand(model1UploadParams));
    console.log('Successfully set up test resources.');
  } catch (e) {
    console.error('Error while setting up test resources, please check logs, clean up, and restart test. \n', e);
    throw(e);
  }

  // 3. Create some TwinMaker resources
  console.log('Setting up first round of TwinMaker resources.');
  try {
    await aws().tm.createComponentType(constants.componentType1Input);
    await aws().tm.createScene(constants.scene1Input); // Scene already contains model 1
    await aws().tm.createEntity(constants.entity1Input);
    console.log('Successfully set up first round of TwinMaker resources.');
  } catch (e) {
    console.error('Error while creating TwinMaker resources, please check logs, clean up, and restart test. \n', e);
    throw(e);
  }

  // 4. Init tmdk project
  console.log('Using init to initialize tmdk project in dir: ' + constants.tmdkDirectory);
  argv2 = {
    _: [ 'init' ],
    '$0': 'tmdk_local',
    region: constants.region,
    'workspace-id': constants.workspaceId,
    out: constants.tmdkDirectory
  } as Arguments<init.Options>;
  expect(await init.handler(argv2)).toBe(0);

  // 5. Validate tmdk definition
  console.log('Init succeeded, validating tmdk definition in dir: ' + constants.tmdkDirectory);
  const tmdkDefinition1 = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, 'tmdk.json'), constants.jsonEncoding));
  expect(tmdkDefinition1['component-types']).toStrictEqual( [ 'testComponentType1.json' ]);
  const ct1Definition = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, 'testComponentType1.json'), constants.jsonEncoding));
  expect(ct1Definition['componentTypeId']).toStrictEqual('testComponentType1');
  expect(tmdkDefinition1['scenes']).toStrictEqual([ 'testScene1.json' ]);
  const scene1Definition = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, 'testScene1.json'), constants.jsonEncoding));
  expect(scene1Definition['nodes'][0]['name']).toStrictEqual('CookieFactoryMixer');
  expect(tmdkDefinition1['models']).toStrictEqual([ 'CookieFactoryMixer.glb' ]);
  expect(tmdkDefinition1['entities']).toStrictEqual('entities.json');
  expect(fs.existsSync(path.join(constants.tmdkDirectory, 'entities.json'))).toBeTruthy();
  const entities1Definition = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, 'entities.json'), constants.jsonEncoding));
  expect(entities1Definition[0]['entityName']).toStrictEqual('testEntity1');
  console.log('tmdk definition validated successfully');

  // 6. Update tmdk definition, add resources
  console.log('Updating tmdk definition in dir: ' + constants.tmdkDirectory + ' and adding resources');
  fs.copyFileSync(path.join(constants.localResourcesDir, constants.model2FileName),
    path.join(constants.tmdkDirectory, '3d_models/' + constants.model2FileName));
  let scene2Definition = JSON.parse(fs.readFileSync(path.join(constants.localResourcesDir, constants.scene2FileName),
    constants.jsonEncoding));
  scene2Definition['nodes'][0]['components'][0]['uri'] = model1S3Location;
  scene2Definition['nodes'][1]['components'][0]['uri'] = model2S3Location;
  fs.writeFileSync(path.join(constants.tmdkDirectory, constants.scene2FileName), JSON.stringify(scene2Definition));
  fs.writeFileSync(path.join(constants.tmdkDirectory, constants.componentType2Name), JSON.stringify(constants.componentType2));
  let entities = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, constants.entitiesFile), constants.jsonEncoding));
  const entity1Id = entities[0].entityId;
  entities.push(constants.entity2Definition);
  fs.writeFileSync(path.join(constants.tmdkDirectory, 'entities.json'), JSON.stringify(entities));
  let tmdkDefinition = JSON.parse(fs.readFileSync(path.join(constants.tmdkDirectory, constants.tmdkFile), constants.jsonEncoding));
  tmdkDefinition['component-types'].push(constants.componentType2Name);
  tmdkDefinition['scenes'].push(constants.scene2FileName);
  tmdkDefinition['models'].push(constants.model2FileName);
  fs.writeFileSync(path.join(constants.tmdkDirectory, constants.tmdkFile), JSON.stringify(tmdkDefinition));
  console.log('tmdk definition updated');

  // 7. Deploy to workspace
  console.log('Deploying updated tmdk project to workspace: ' + constants.workspaceId);
  argv2 = {
    _: [ 'deploy' ],
    '$0': 'tmdk_local',
    region: constants.region,
    'workspace-id': constants.workspaceId,
    dir: constants.tmdkDirectory
  } as Arguments<deploy.Options>;
  expect(await deploy.handler(argv2)).toBe(0);

  // 8. Validate resources were created
  console.log('Verifying TwinMaker resource in dir: ' + constants.tmdkDirectory);
  // Verify Component Types
  let componentType1Result: GetComponentTypeCommandOutput =  await aws().tm.getComponentType({ workspaceId: constants.workspaceId,
    componentTypeId: constants.componentType1Input.componentTypeId });
  expect(componentType1Result.componentTypeId).toEqual(constants.componentType1Input.componentTypeId);
  expect(componentType1Result.status).toMatchObject({state: constants.resourceActiveState});
  let componentType2Result: GetComponentTypeCommandOutput =  await aws().tm.getComponentType({ workspaceId: constants.workspaceId,
    componentTypeId: constants.componentType2.componentTypeId });
  expect(componentType2Result.componentTypeId).toEqual(constants.componentType2.componentTypeId);
  expect(componentType2Result.status).toMatchObject({state: constants.resourceActiveState});
  // Verify Entities
  let entity1Result = await aws().tm.getEntity({ workspaceId: constants.workspaceId, entityId: entity1Id });
  expect(entity1Result.entityId).toEqual(entity1Id);
  expect(entity1Result.entityName).toEqual(constants.entity1Input.entityName);
  expect(entity1Result.status!.state).toBe(constants.resourceActiveState);
  let listEntitiesResult: EntitySummary[] = (await aws().tm.listEntities({ workspaceId: constants.workspaceId })).entitySummaries!;
  listEntitiesResult.forEach(function (entity) {
    if (entity.entityName === constants.entity2Definition.entityName ) {
      expect(entity.status!.state).toBe(constants.resourceActiveState);
    }
  });
  // Verify Scenes
  let scene1Result = await aws().tm.getScene({ workspaceId: constants.workspaceId, sceneId: constants.scene1Input.sceneId });
  expect(scene1Result.contentLocation).toBe(scene1S3Location);
  let scene1S3Response = await aws().s3.getObject({
    Bucket: workspaceS3BucketName,
    Key: constants.scene1FileName
  });
  let scene1JsonResult = JSON.parse(await scene1S3Response.Body!.transformToString(constants.jsonEncoding));
  expect(scene1JsonResult.nodes[0].name).toBe(constants.model1FileName.replace('.glb', ''));
  let scene2Result = await aws().tm.getScene({ workspaceId: constants.workspaceId,
    sceneId: constants.scene2FileName.replace('.json', '') });
  expect(scene2Result.contentLocation).toBe(scene1S3Location.replace(constants.scene1FileName, constants.scene2FileName));
  let scene2S3Response = await aws().s3.getObject({
    Bucket: workspaceS3BucketName,
    Key: constants.scene2FileName
  });
  let scene2JsonResult = JSON.parse(await scene2S3Response.Body!.transformToString(constants.jsonEncoding));
  let scene2ModelNames: string[] = [];
  scene2JsonResult.nodes.forEach(function (model: { name: string }) {
    scene2ModelNames.push(model.name);
  });
  expect(scene2ModelNames).toContain(constants.model1FileName.replace('.glb', ''));
  expect(scene2ModelNames).toContain(constants.model2FileName.replace('.glb', ''));
  // Verify Models
  let model1S3Response = await aws().s3.getObject({
    Bucket: workspaceS3BucketName,
    Key: constants.model1FileName
  });
  expect(model1S3Response).toHaveProperty('Body');
  let model2S3Response = await aws().s3.getObject({
    Bucket: workspaceS3BucketName,
    Key: constants.model2FileName
  });
  expect(model2S3Response).toHaveProperty('Body');
  console.log('TwinMaker resources verified, deploy successfully created resources.');

  // 9. Nuke workspace
  console.log('Nuking workspace: ' + constants.workspaceId);
  argv2 = {
    _: [ 'nuke' ],
    '$0': 'tmdk_local',
    region: 'us-east-1',
    'workspace-id': constants.workspaceId
  } as Arguments<nuke.Options>;
  expect(await nuke.handler(argv2)).toBe(0);

  // 10. Validate nuke
  console.log('Validating nuke cleared all TwinMaker resources.');
  expect((await aws().tm.listEntities({ workspaceId: constants.workspaceId })).entitySummaries!).toMatchObject([]);
  expect((await aws().tm.listScenes({ workspaceId: constants.workspaceId })).sceneSummaries!).toMatchObject([]);
  let listComponentTypesResult: ComponentTypeSummary[] =
    (await aws().tm.listComponentTypes({ workspaceId: constants.workspaceId })).componentTypeSummaries!;
  listComponentTypesResult.forEach(function (componentType) {
    expect(componentType.componentTypeId!.includes('com.amazon')).toBeTruthy();
  });
  console.log('Nuke successfully deleted all TwinMaker resources.');

  // 1. Clean up
  console.log('Cleaning up test resources.');
  try {
    await aws().tm.deleteWorkspace({workspaceId: constants.workspaceId});
    await aws().s3.send(new DeleteObjectCommand({Bucket: workspaceS3BucketName, Key: constants.model1FileName}));
    await aws().s3.send(new DeleteObjectCommand({Bucket: workspaceS3BucketName, Key: constants.model2FileName}));
    await aws().s3.send(new DeleteObjectCommand({Bucket: workspaceS3BucketName, Key: constants.scene1FileName}));
    await aws().s3.send(new DeleteObjectCommand({Bucket: workspaceS3BucketName, Key: constants.scene2FileName}));
    await aws().s3.deleteBucket({Bucket: workspaceS3BucketName});
    await aws().iam.deleteRolePolicy({RoleName: twinMakerRoleName, PolicyName: twinMakerPolicyName});
    await aws().iam.deleteRole({RoleName: twinMakerRoleName});
  } catch (e) {
    console.error('Error while deleting test resources. \n', e);
  }

  console.log('//////      TEST PASS     //////');
}, 999999);
