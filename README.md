# REMOTE MONITERING EMBEDDED SYSTEMS PRODUCT

## Running camera
1. Run `python3 stream.py`
2. Open http://100.125.67.124:5000/ on whatever device your remoted in from


## Upload code remotely
1. `cd embedded_software`
2. Edit src/main.cpp or any other files in src/
🧨 EVERY setup() NEEDS TO START WITH A CALL TO delay(1500) WITH AT LEAST 1500!!!! OR BAD THINGS HAPPEN!!
3. Run `pio run -t upload`
4. [OPTIONAL] `pio device monitor -b 115200` to start a seriel moniter
