#include "soc/gpio_struct.h"
#include "driver/ledc.h"
#include "esp_rom_sys.h"
#include "esp_rom_uart.h"
#include "../vis_ssh_on/vis_ssh_on.hpp"

#define SERVO1_PIN 11
#define SERVO2_PIN 12

vis_ssh_on vis;

// SG90 timing constants
#define SERVO_MIN_US 500
#define SERVO_MAX_US 2500
#define SERVO_FREQ_HZ 50

uint32_t us_to_duty(uint32_t us) {
    return (uint32_t)((us * 16383) / 20000);
}

uint32_t angle_to_us(int angle) {
    return SERVO_MIN_US +
           ((SERVO_MAX_US - SERVO_MIN_US) * angle) / 180;
}

void set_servo_angle(ledc_channel_t channel, int angle) {
    uint32_t pulse_us = angle_to_us(angle);
    uint32_t duty = us_to_duty(pulse_us);

    ledc_set_duty(LEDC_LOW_SPEED_MODE, channel, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, channel);
}

void move_servo_slow(ledc_channel_t channel,
                     int start_angle,
                     int end_angle,
                     int step_delay_ms = 20,
                     int step_size = 1) {

    if (start_angle < end_angle) {

        for (int angle = start_angle; angle <= end_angle; angle += step_size) {
            set_servo_angle(channel, angle);
            esp_rom_delay_us(step_delay_ms * 1000);
        }

    } else {

        for (int angle = start_angle; angle >= end_angle; angle -= step_size) {
            set_servo_angle(channel, angle);
            esp_rom_delay_us(step_delay_ms * 1000);
        }
    }
}

extern "C" void app_main(void) {

    esp_rom_delay_us(2000000); // DO NOT DELETE

    // Timer config
    ledc_timer_config_t timer_config = {};
    timer_config.speed_mode = LEDC_LOW_SPEED_MODE;
    timer_config.timer_num = LEDC_TIMER_0;
    timer_config.duty_resolution = LEDC_TIMER_14_BIT;
    timer_config.freq_hz = SERVO_FREQ_HZ;
    timer_config.clk_cfg = LEDC_AUTO_CLK;

    ledc_timer_config(&timer_config);

    // Servo 1 channel config
    ledc_channel_config_t servo1 = {};
    servo1.gpio_num = SERVO1_PIN;
    servo1.speed_mode = LEDC_LOW_SPEED_MODE;
    servo1.channel = LEDC_CHANNEL_0;
    servo1.intr_type = LEDC_INTR_DISABLE;
    servo1.timer_sel = LEDC_TIMER_0;
    servo1.duty = 0;
    servo1.hpoint = 0;

    ledc_channel_config(&servo1);

    // Servo 2 channel config
    ledc_channel_config_t servo2 = {};
    servo2.gpio_num = SERVO2_PIN;
    servo2.speed_mode = LEDC_LOW_SPEED_MODE;
    servo2.channel = LEDC_CHANNEL_1;
    servo2.intr_type = LEDC_INTR_DISABLE;
    servo2.timer_sel = LEDC_TIMER_0;
    servo2.duty = 0;
    servo2.hpoint = 0;

    ledc_channel_config(&servo2);

    int i = 0;
    while (i != 1) {
        set_servo_angle(LEDC_CHANNEL_0, 0);
        vis.test_out("starting test!");
        /*
        move_servo_slow(LEDC_CHANNEL_0, 0, 90, 25, 1);
        esp_rom_delay_us(1000000);
        
        set_servo_angle(LEDC_CHANNEL_0, 0);
        */
        

        move_servo_slow(LEDC_CHANNEL_1, 0, 90, 25, 1);
        esp_rom_delay_us(1000000 * 8);

        move_servo_slow(LEDC_CHANNEL_1, 90, 0, 25, 1);
        
        ++i;
    }
}