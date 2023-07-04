# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved. 2023
# SPDX-License-Identifier: Apache-2.0

from udq_utils.udq import SingleEntityReader, MultiEntityReader, IoTTwinMakerDataRow, IoTTwinMakerUdqResponse
from udq_utils.udq_models import IoTTwinMakerUDQEntityRequest, IoTTwinMakerUDQComponentTypeRequest, OrderBy, IoTTwinMakerReference, \
    EntityComponentPropertyRef
from datetime import datetime, timedelta
import json
import pandas as pd
import os

# read the telemetry data interval
DATA_INTERVAL = 30
try:
    DATA_INTERVAL = int(os.environ['TELEMETRY_OEE_TIME_INTERVAL_SECONDS'])
except:
    pass # use default interval

# read the telemetry data sample into a pandas dataframe for serving queries
data = []

try:
   telemetryDataFileName = os.environ['TELEMETRY_OEE_FILE_NAME']
   if telemetryDataFileName is None or telemetryDataFileName.strip() == '':
       telemetryDataFileName = 'OEEmetrics.json'
   print(f"telemetryOEEFileName: {telemetryDataFileName}")
   with open(telemetryDataFileName, 'r') as f:
       lines = f.readlines()
       for line in lines:
           data.append(json.loads(line.strip()))
except:
   with open('OEEmetrics.json', 'r') as f:
       lines = f.readlines()
       for line in lines:
           data.append(json.loads(line.strip()))

df = pd.DataFrame(data)

class RenderIoTTwinMakerDataRow(IoTTwinMakerDataRow):

    def __init__(self, dt, value, property_name, entity_id):
        self.dt = dt
        self.value = value
        self.property_name = property_name
        self.entity_id = entity_id
        pass

    def get_iottwinmaker_reference(self) -> IoTTwinMakerReference:
        # Note: this synthetic data generator is currently specific to CookieLine
        return IoTTwinMakerReference(ecp=EntityComponentPropertyRef(
            entity_id=self.entity_id,
            component_name='OEEComponent',
            property_name=self.property_name
        ))

    def get_iso8601_timestamp(self) -> str:
        return self.dt.strftime('%Y-%m-%dT%H:%M:%S.%fZ')

    def get_value(self):
        return self.value

class RenderValuesReader(SingleEntityReader, MultiEntityReader):
    def __init__(self):
        pass

    def entity_query(self, request: IoTTwinMakerUDQEntityRequest) -> IoTTwinMakerUdqResponse:
        return IoTTwinMakerUdqResponse(rows=self._get_data_rows(request))

    def component_type_query(self, request: IoTTwinMakerUDQComponentTypeRequest) -> IoTTwinMakerUdqResponse:
        # Note: this synthetic data generator currently only supports single-entity queries
        #       alarm data will not appear in scenes from GetAlarms query
        return IoTTwinMakerUdqResponse([], None)

    def _get_data_rows(self, request):
        start_dt = request.start_datetime
        end_dt = request.end_datetime
        max_rows = request.max_rows

        data_rows = []

        for selected_property in request.selected_properties:
            df2 = df.copy()
            df2.reset_index()


            data_index = df2[df2['entityId'] == request.entity_id][[selected_property, 'Time']].set_index('Time').to_dict('records')

            # determine the relative start point in the data set to generate synthetic data for, as well as number of data points to return
            epoch_start_in_seconds = start_dt.timestamp()
            sample_time_range_length_in_seconds = (len(data_index) * (DATA_INTERVAL))
            start_interval_bin = epoch_start_in_seconds % sample_time_range_length_in_seconds
            start_interval_bin_in_index = int(start_interval_bin / (DATA_INTERVAL))
            number_of_datapoints = min(max_rows, int((end_dt.timestamp() - start_dt.timestamp()) / (DATA_INTERVAL)))

            # generate data response by repeatedly iterating over the data sample
            curr_dt = datetime.fromtimestamp(int(start_dt.timestamp() / (DATA_INTERVAL)) * (DATA_INTERVAL))
            curr_index = start_interval_bin_in_index
            for i in range(number_of_datapoints):
                dt = curr_dt
                value = data_index[curr_index][selected_property]

                data_rows.append(RenderIoTTwinMakerDataRow(dt, value, selected_property, request.entity_id))

                curr_dt = dt + timedelta(seconds=DATA_INTERVAL)
                curr_index = (curr_index + 1) % len(data_index)
    
        return data_rows

RENDER_READER = RenderValuesReader()

# Main Lambda invocation entry point
# noinspection PyUnusedLocal
def lambda_handler(event, context):
    print('Event: %s', event)
    result = RENDER_READER.process_query(event)
    print("result:")
    print(result)
    return result