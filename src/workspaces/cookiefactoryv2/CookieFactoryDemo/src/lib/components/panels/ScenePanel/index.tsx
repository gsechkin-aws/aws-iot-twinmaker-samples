import {
  SceneViewer,
  useSceneComposerApi,
  type SelectionChangedEventCallback,
  type WidgetClickEventCallback
} from '@iot-app-kit/scene-composer';
import { useCallback, useEffect } from 'react';

import { VIEWPORT } from '@/config/iottwinmaker';
import { normalizedEntityData } from '@/lib/entities';
import { useTimeSeriesDataQuery } from '@/lib/hooks';
import { useSceneLoaderState, useSelectedEntityState } from '@/lib/state';
import type { DataBindingContext, EntityData } from '@/lib/types';
import { createClassName, type ClassName } from '@/lib/utils/element';
import { getEntityHistoryQuery } from '@/lib/utils/entity';
import { isNil } from '@/lib/utils/lang';

import styles from './styles.module.css';

const sceneComposerId = crypto.randomUUID();
const alarmHistoryQuery = normalizedEntityData.map((entity) => getEntityHistoryQuery(entity, 'alarm'));

export const ScenePanel = ({ className }: { className?: ClassName }) => {
  const { findSceneNodeRefBy, setSelectedSceneNodeRef, setCameraTarget } = useSceneComposerApi(sceneComposerId);
  const [alarmQuery, setAlarmQuery] = useTimeSeriesDataQuery();
  const [selectedEntity, setSelectedEntity] = useSelectedEntityState();
  const [sceneLoader] = useSceneLoaderState();

  const handleSelectionChange: SelectionChangedEventCallback = useCallback(
    ({ componentTypes, additionalComponentData }) => {
      const { type } = selectedEntity;

      if (
        type === 'scene' &&
        componentTypes.length &&
        componentTypes.every((item) => item !== 'Tag') &&
        (isNil(additionalComponentData) || additionalComponentData.length === 0)
      ) {
        setSelectedEntity({ entityData: null, type: 'scene' });
      }
    },
    [selectedEntity]
  );

  const handleWidgetClick: WidgetClickEventCallback = useCallback(({ additionalComponentData }) => {
    let entityData: EntityData | null = null;

    if (additionalComponentData && additionalComponentData.length) {
      const { dataBindingContext } = additionalComponentData[0];

      if (dataBindingContext) {
        const { entityId } = dataBindingContext as DataBindingContext;
        entityData = normalizedEntityData.find((entity) => entity.entityId === entityId) ?? null;
      }
    }

    setSelectedEntity({ entityData, type: 'scene' });
  }, []);

  useEffect(() => {
    const { entityData, type } = selectedEntity;

    if (entityData && type !== 'scene') {
      const { entityId, componentName } = entityData;
      const nodeRefs = findSceneNodeRefBy({ entityId, componentName });

      if (nodeRefs && nodeRefs.length > 0) {
        setCameraTarget(nodeRefs[nodeRefs.length - 1], 'transition');
        setSelectedSceneNodeRef(nodeRefs[nodeRefs.length - 1]);
      }
    }

    if (isNil(entityData) && type !== 'scene') {
      setSelectedSceneNodeRef(undefined);
    }
  }, [selectedEntity]);

  useEffect(() => {
    setAlarmQuery(alarmHistoryQuery);
  }, []);

  console.dir(selectedEntity);

  return (
    <main className={createClassName(styles.root, className)}>
      {sceneLoader && (
        <SceneViewer
          sceneComposerId={sceneComposerId}
          config={{
            dracoDecoder: {
              enable: true,
              path: 'https://www.gstatic.com/draco/versioned/decoders/1.5.3/' // path to the draco files
            }
          }}
          queries={alarmQuery}
          selectedDataBinding={selectedEntity.entityData ?? undefined}
          sceneLoader={sceneLoader}
          onSelectionChanged={handleSelectionChange}
          onWidgetClick={handleWidgetClick}
          viewport={VIEWPORT}
        />
      )}
    </main>
  );
};
