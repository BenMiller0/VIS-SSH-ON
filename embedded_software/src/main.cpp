#include <Arduino.h>

struct Res {
    int Rot1;
    int Rot2;
    int Rot3;
    int Rot4;
    int Rot5;
};

int mapAngle(int raw) {
    int angle;
    if (raw < 1000) {
        angle = map(raw, 0, 1000, 0, 90);
    } else {
        angle = map(raw, 1000, 2405, 90, 180);
    }
    return constrain(angle, 0, 180);
}

void updateState() {
    int pins[5] = {A0, A1, A2, A3, A4};
    
    for (int i = 0; i < 5; i++) {
        int raw = analogRead(pins[i]);
        int angle = mapAngle(raw);
        Serial.print("Rot");
        Serial.print(i + 1);
        Serial.print(": ");
        Serial.print(angle);
        Serial.print(" deg");
        if (i < 4) Serial.print("  |  ");
    }
    Serial.println();
}

void setup() {
    Serial.begin(115200);
}

void loop() {
    updateState();
    delay(500);
}