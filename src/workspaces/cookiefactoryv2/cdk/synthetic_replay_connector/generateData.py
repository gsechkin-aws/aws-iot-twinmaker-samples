"""
Cookiefactory Simulation Data POC
Scenario:
  FILLIN

TEMP Developer Instructions:
To run this file:
 1. Navigate to folder dir in terminal (synthetic_replay_connector)
 2. pip3 install simpy
 3. (Optional) Make any changes to simualator values you need, e.g. data_time_interval
 4. python3 generateData.py
"""
import random
import simpy
import json
import os
import datetime


RANDOM_SEED = 10
SIM_TIME = 4 # Simulation time in minutes


def time_per_batch(speed):
    """Return actual processing time for a batch of cookies for any equipment in the cookieline."""
    return 1.5/speed


def time_to_failure(MTTF):
    """Return time until next failure for a piece of equipment."""
    # Mean time to failure in minutes
    BREAK_MEAN = 1 / MTTF  # Param. for expovariate distribution
    return random.expovariate(BREAK_MEAN)

class CookieLine(object):
    """Driver class for cookieline that facilates the equipment, records metadata and OEE metrics, and triggers

    simulated scenarios such as coolant leaks
    """
    def __init__(self, env, speed, entityId):
        self.env = env
        self.batches_processed = 0
        self.speed = speed
        self.entityId = entityId
        # Initialize current time used for timestamp as 00:00:00
        self.current_time = datetime.datetime(100,1,1,0,0,0)
        # Initialize OEE helper metrics
        self.down_time = 0
        self.total_batches_produced = 0
        self.bad_batches_output = 0
        self.repairing_flag = False
        

        self.start_cookieline()
        # Record equipment metadata into CSV every 10 seconds (1/6 minute)
        time_interval = 1/6
        env.process(self.record_metadata(time_interval))
        # Record OEE metrics into CSV every 30 seconds (demo purposes only)
        OEE_time_interval = 0.501 # set to 0.501 instead of 0.5 to avoid inconsistent behavior of concurrent record_OEE and record_metadata calls
        env.process(self.record_OEE_metrics(OEE_time_interval))

    def start_cookieline(self):
        # Initialize machines    
        labelingBelt = CookielineEquipment(env, "LABELING_BELT_5f98ffd2-ced1-48dd-a111-e3503b4e8532", self.speed, 30, 3, child=None)
        boxSealer = CookielineEquipment(env, "BOX_SEALER_ad434a34-4363-4a36-8153-20bd7189951d", self.speed, 30, 3, child=labelingBelt)
        conveyorLeft = CookielineEquipment(env, "CONVEYOR_LEFT_TURN_b28f2ca9-b6a7-44cd-a62d-7f76fc17ba45", self.speed, 30, 3, child=boxSealer)
        conveyorStraight = CookielineEquipment(env, "CONVEYOR_STRIGHT_9c62c546-f8ef-489d-9938-d46a12c97f32", self.speed, 30, 3, child=conveyorLeft)
        conveyorRight = CookielineEquipment(env, "CONVEYOR_RIGHT_TURN_c4f2df3d-26a2-45c5-a6c9-02ca00eb4af6", self.speed, 30, 3, child=conveyorStraight)
        plasticLiner = CookielineEquipment(env, "PLASTIC_LINER_a77e76bc-53f3-420d-8b2f-76103c810fac", self.speed, 30, 3, child=conveyorRight)
        boxErector = CookielineEquipment(env, "BOX_ERECTOR_142496af-df2e-490e-aed5-2580eaf75e40", self.speed, 30, 3, child=plasticLiner)
        verticalConveyor = CookielineEquipment(env, "VERTICAL_CONVEYOR_d5423f7f-379c-4a97-aae0-3a5c0bcc9116", self.speed, 30, 3, child=conveyorStraight)
        freezingTunnel = CookielineEquipment(env, "FREEZER_TUNNEL_e12e0733-f5df-4604-8f10-417f49e6d298", self.speed, -20, 3, child=verticalConveyor)
        cookieFormer = CookielineEquipment(env, "COOKIE_FORMER_19556bfd-469c-40bc-a389-dbeab255c144", self.speed, 30, 3, child=freezingTunnel)

        self.cookieline = [cookieFormer, freezingTunnel, verticalConveyor, boxErector, plasticLiner, 
                           conveyorRight, conveyorStraight, conveyorLeft, boxSealer, labelingBelt]

    def record_OEE_metrics(self, OEE_time_interval):
        """Record cookieline OEE into CSV file at a pre-determined interval"""
        while True:
            yield self.env.timeout(OEE_time_interval)
            # Calculate OEE:

            # Formula: Availability = (Potential production time - down time) / potential production time
            availability = (env.now - self.down_time) / env.now
            # Formula Performance = Actual output / (Actual Production time / Ideal cycle time)
            potential_output = (env.now - self.down_time) / time_per_batch(self.speed)
            # Default performance set to 1.0 if there is no potential output in the elapsed time yet
            performance = 1.0
            if (potential_output > 1):
                performance = self.total_batches_produced / potential_output
            # Formula: Quality = good unit output / Actual output
            # Default quality set to 1.0 if there is no actual output in the elapsed time yet
            quality = 1.0 
            if (self.total_batches_produced):
                quality = (self.total_batches_produced - self.bad_batches_output) / self.total_batches_produced

            # Formula: OEE = A * P * Q
            OEE = availability * performance * quality

            dictionary = {"OEE":OEE, "Availability":availability, "Performance":performance, "Quality":quality, "Time":str(self.current_time.time()), 
                          "entityId": self.entityId}
            # Add to output file
            with open("OEEmetrics.json", "a") as outfile:
                json.dump(dictionary, outfile)
                outfile.write('\n')


    def record_metadata(self, data_time_interval):
        """Record equipment metadata into CSV file at a pre-determined interval"""
        while True:
            for i in range(len(self.cookieline)):
                # Collect component type information for equipment
                dictionary = {"Speed":self.cookieline[i].speed, "Temperature":self.cookieline[i].temperature, "AlarmSeverity":self.cookieline[i].alarm_severity, 
                            "AlarmMessage": str(self.cookieline[i].alarm_message), "Time":str(self.current_time.time()), 
                            "Alarming":self.cookieline[i].alarming, "entityId": self.cookieline[i].entityId}
                # Add to output file
                with open("demoTelemetryData.json", "a") as outfile:
                    json.dump(dictionary, outfile)
                    outfile.write('\n')
            yield self.env.timeout(data_time_interval)
            # increment datetime object
            self.current_time = self.current_time + datetime.timedelta(minutes=data_time_interval)


class CookielineEquipment(object):
    """A generic object that represents a piece of equipment in the cookieline.

    Each piece of equipment has a speed, a temperature, and an alarming status.
    """
    def __init__(self, env, entityId, speed, temperature, speed_threshold, child):
        self.env = env
        self.entityId = entityId
        self.speed = speed
        self.temperature = temperature
        self.child = child
        self.speed_threshold = speed_threshold
        self.batches_processed = 0
        self.alarming = False
        self.alarm_severity = "Normal"
        self.alarm_message = None

        # NOTE: currently, alarm severity "HIGH" means coolant leak, and "LOW" means speed loss hard coded in CookieFactoryDemo folder

        # Start "working" and "simulate_slowdown" and "simulate_coolant_leak" processes for this machine.
        self.process = env.process(self.working())
        env.process(self.simulate_machine_slowdown(speed_threshold))
        if (self.entityId == "FREEZER_TUNNEL_e12e0733-f5df-4604-8f10-417f49e6d298"):
            env.process(self.simulate_coolant_leak())


    def working(self):
        """Produce cookies as long as the simulation runs.

        The equipment speed or temperature may cause an alarming status, taking time to repair.

        """         
        while True:
            # Start working on next batch
            done_in = time_per_batch(self.speed)
            bad_batch_flag = False
            while done_in:
                try:
                    # Working
                    start = self.env.now
                    yield self.env.timeout(done_in)
                    done_in = 0  # Set to 0 to exit while loop.
                    # Batch is processed.
                    self.batches_processed += 1
                    if (bad_batch_flag):
                        cookieline.bad_batches_output += 1
                        bad_batch_flag = False
                    # If it is the last machine in line, add total to cookieline
                    if (self.child == None):
                        cookieline.total_batches_produced += 1

                except simpy.Interrupt:
                    # Handle slowdowns!
                    if (self.alarm_severity == "Low"):
                        print(str(self.entityId) + " abnormal speed reduction at time " + str(env.now))
                        self.alarm_message = {'subject':'Abnormal speed reduction', 'body':f'[Warning: Speed slowed abnormally on {self.entityId}'}
                        done_in -= self.env.now - start  # How much time left?

                        # Inform all downstream machines about repair!
                        if (self.child != None and not self.child.alarming):
                            self.child.alarm_severity = "Medium"
                            self.child.alarming = True
                            self.child.process.interrupt()
                        
                        # Fix the issue
                        REPAIR_TIME = 0.5
                        cookieline.repairing_flag = True
                        yield self.env.timeout(REPAIR_TIME)
                        cookieline.repairing_flag = False
                        cookieline.down_time += REPAIR_TIME

                        self.alarming = False
                        self.alarm_severity = "Normal"
                        self.speed = 6
                        self.temperature = 30
                        self.alarm_message = None
                        print(str(self.entityId) + " is FIXED at time " + str(self.env.now))
                    # Special case: Handle coolant leaks for freezer tunnel
                    elif (self.alarm_severity == "High"):
                        print(str(self.entityId) + " has a COOLANT LEAK at time " + str(env.now))
                        self.alarm_message = {'subject':'LN2 vapor flowing over exhaust troughs', 'body':'[Critical] Clogged exhaust pipe or full blast gate in piping'}
                        # This batch of cookies will be lower quality because it was not properly frozen
                        bad_batch_flag = True
                        done_in -= self.env.now - start  # How much time left?

                        # Inform all downstream machines about repair!
                        if (self.child != None and not self.child.alarming):
                            self.child.alarm_severity = "Medium"
                            self.child.alarming = True
                            self.child.process.interrupt()
                        # Fix the issue
                        REPAIR_TIME = 0.5
                        cookieline.repairing_flag = True
                        yield self.env.timeout(REPAIR_TIME)
                        cookieline.repairing_flag = False
                        cookieline.down_time += REPAIR_TIME

                        self.alarming = False
                        self.alarm_severity = "Normal"
                        self.temperature = -20
                        self.alarm_message = None
                        print(str(self.entityId) + " is FIXED at time " + str(self.env.now))
                        
                    elif (self.alarm_severity == "Medium"):
                        self.alarm_message = {'subject':'Scheduled repair', 'body':f'[Warning: {self.entityId} is blocked for repairs'}
                        #print(str(self.entityId) + " is down for upstream repairs")
                        # Inform all downstream machines about repair!
                        if (self.child != None and not self.child.alarming):
                            self.child.alarm_severity = "Medium"
                            self.child.alarming = True
                            self.child.process.interrupt()
                        
                        done_in -= self.env.now - start  # How much time left?

                        # fix the issue
                        REPAIR_TIME = 0.5
                        yield self.env.timeout(REPAIR_TIME)

                        self.alarming = False
                        self.alarm_severity = "Normal"
                        self.alarm_message = None
                        #print(str(self.entityId) + " is back up at time " + str(self.env.now))




    def simulate_machine_slowdown(self, speed_threshold):
        """Slowdown equipment every now and then."""
        if (self.entityId != "FREEZER_TUNNEL_e12e0733-f5df-4604-8f10-417f49e6d298"):
            while True:
                yield self.env.timeout(time_to_failure(MTTF=2)) # Mean time to failure 1 minute
                if not cookieline.repairing_flag:
                    # Only simulate speed slowdown if it is not already alarming
                    self.speed -= 2
                    self.temperature += 3
                    if (self.speed <= speed_threshold):
                        # if we pass our threshold, then we need to alarm and repair
                        self.alarming = True
                        self.alarm_severity = "Low"
                        self.process.interrupt()

    def simulate_coolant_leak(self):
        while True:
            yield self.env.timeout(time_to_failure(MTTF=3)) # Mean time to failure 3 minutes
            if not cookieline.repairing_flag:
                # Only simulate coolant leak if is currently working
                self.alarming = True
                self.alarm_severity = "High"
                self.temperature = -10
                self.process.interrupt()
                while (self.alarming):
                    # The freezer tunnel gets warmer until coolant leak is fixed
                    self.temperature += 1
                    yield self.env.timeout(0.05)


# Setup and start the simulation
  
# check if file exists and remove to start clean
if os.path.exists("demoTelemetryData.json"):
    os.remove("demoTelemetryData.json") 
if os.path.exists("OEEmetrics.json"):
    os.remove("OEEmetrics.json") 
 
print('Simulation start:\n')
random.seed(RANDOM_SEED)  # This helps reproducing the results

# Create an environment and start the setup process
env = simpy.Environment()
cookieline = CookieLine(env, speed=6, entityId="COOKIE_LINE_5ce9f1d5-61b0-433f-a850-53fa7ca27aa1")

# Execute!
env.run(until=SIM_TIME+0.05) # add a 0.05 buffer so that events that finish at t = SIM_TIME count towards metrics
print("\nSimulation Finished\n")
print("Total # of batches processed: " + str(cookieline.cookieline[9].batches_processed))