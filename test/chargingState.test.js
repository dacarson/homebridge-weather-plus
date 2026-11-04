"use strict";

const test = require('node:test');
const assert = require('node:assert');
const {
	CHARGING_STATE_HOLD_MS,
	BATTERY_VOLTAGE_DEADBAND,
	BatteryVoltageTrend,
	ChargingStateHold
} = require('../util/chargingState');

const MINUTE = 60 * 1000;

test('hold time is 15 minutes', () => {
	assert.strictEqual(CHARGING_STATE_HOLD_MS, 15 * MINUTE);
});

test('ChargingStateHold: reports the first known state immediately on startup', () => {
	const hold = new ChargingStateHold();
	assert.strictEqual(hold.update(undefined, 0), undefined, 'unknown state is not reported');
	assert.strictEqual(hold.update(true, 1 * MINUTE), true);

	const hold2 = new ChargingStateHold();
	assert.strictEqual(hold2.update(false, 0), false);
});

test('ChargingStateHold: brief flips are ignored', () => {
	const held = [];
	const hold = new ChargingStateHold(CHARGING_STATE_HOLD_MS, (msg) => held.push(msg));
	hold.update(false, 0);

	// Flip to charging for 5 minutes, then back.
	let t = 0;
	for (let i = 1; i <= 5; i++) {
		t = i * MINUTE;
		assert.strictEqual(hold.update(true, t), false);
	}
	assert.strictEqual(hold.update(false, 6 * MINUTE), false);
	assert.ok(held.length > 0, 'held-back changes are logged');
	assert.match(held[0], /Holding back Charging State change to CHARGING/);

	// Alternating every minute for an hour never changes the reported state.
	for (let i = 7; i < 67; i++) {
		assert.strictEqual(hold.update(i % 2 === 0, i * MINUTE), false);
	}
});

test('ChargingStateHold: a sustained change is reported after 15 minutes', () => {
	const hold = new ChargingStateHold();
	hold.update(false, 0);

	const start = 10 * MINUTE;
	for (let m = 0; m < 15; m++) {
		assert.strictEqual(hold.update(true, start + m * MINUTE), false, 'still held at ' + m + ' min');
	}
	assert.strictEqual(hold.update(true, start + 15 * MINUTE), true, 'reported at 15 min');
	assert.strictEqual(hold.update(true, start + 16 * MINUTE), true);
});

test('ChargingStateHold: an interruption restarts the hold timer', () => {
	const hold = new ChargingStateHold();
	hold.update(false, 0);

	for (let m = 1; m <= 10; m++) hold.update(true, m * MINUTE);
	hold.update(false, 11 * MINUTE); // back to the reported state
	for (let m = 12; m < 27; m++) {
		assert.strictEqual(hold.update(true, m * MINUTE), false);
	}
	assert.strictEqual(hold.update(true, 27 * MINUTE), true);
});

test('ChargingStateHold: unknown readings do not reset a pending change', () => {
	const hold = new ChargingStateHold();
	hold.update(false, 0);
	hold.update(true, 1 * MINUTE);
	hold.update(undefined, 5 * MINUTE);
	assert.strictEqual(hold.update(true, 16 * MINUTE), true);
});

test('BatteryVoltageTrend: unknown until the voltage moves past the deadband', () => {
	const trend = new BatteryVoltageTrend();
	assert.strictEqual(trend.update(2.650), undefined);
	assert.strictEqual(trend.update(2.655), undefined);
	assert.strictEqual(trend.update(2.645), undefined);
	assert.strictEqual(trend.update(2.650 + BATTERY_VOLTAGE_DEADBAND + 0.001), true);
});

test('BatteryVoltageTrend: noise within the deadband counts as no change', () => {
	const trend = new BatteryVoltageTrend();
	trend.update(2.650);
	trend.update(2.665); // charging
	const noise = [2.662, 2.668, 2.660, 2.669, 2.661, 2.664];
	noise.forEach((v) => assert.strictEqual(trend.update(v), true));
});

test('BatteryVoltageTrend: a slow change accumulates and is detected', () => {
	const trend = new BatteryVoltageTrend();
	let v = 2.700;
	trend.update(v);
	// Discharge at 1 mV per reading: each step is inside the deadband.
	let state;
	for (let i = 0; i < 12; i++) {
		v -= 0.001;
		state = trend.update(v);
	}
	assert.strictEqual(state, false);
});

test('BatteryVoltageTrend: ignores missing or invalid voltages', () => {
	const trend = new BatteryVoltageTrend();
	assert.strictEqual(trend.update(null), undefined);
	assert.strictEqual(trend.update(undefined), undefined);
	assert.strictEqual(trend.update(NaN), undefined);
	trend.update(2.600);
	trend.update(2.620);
	assert.strictEqual(trend.update(null), true);
});

// End-to-end through the Tempest obs_st parser, without opening the UDP socket.
test('TempestAPI: noisy obs_st voltage does not flap BatteryIsCharging', () => {
	const { TempestAPI } = require('../apis/weatherflow');
	const debug = [];
	const log = Object.assign(() => {}, {
		debug: (msg) => debug.push(msg), info: () => {}, warn: () => {}, error: () => {}
	});

	const api = Object.create(TempestAPI.prototype);
	Object.assign(api, {
		log,
		tempestStationLock: [],
		seenStations: {},
		pressureHistory: [],
		rainAccumulation: new Array(60).fill(0),
		rainAccumulationMinute: 0,
		latitude: null,
		longitude: null,
		conditionDetail: false,
		currentReport: { BatteryLevel: 100, BatteryIsCharging: false, TemperatureMin: 50, RainDay: 0, WindSpeed: 0 },
		airVoltageTrend: new BatteryVoltageTrend(),
		skyVoltageTrend: new BatteryVoltageTrend(),
	});
	api.chargingStateHold = new ChargingStateHold(CHARGING_STATE_HOLD_MS, (msg) => api.log.debug(msg));

	const obs = (epoch, volts) => ({
		type: 'obs_st',
		serial_number: 'ST-00000001',
		firmware_revision: 1,
		obs: [[epoch, 0, 0, 0, 0, 3, 1013.2, 15, 60, 1000, 1, 100, 0, 0, 0, 0, volts, 1]]
	});

	const start = 1700000000;
	const states = [];
	// Charge steadily, then sit on a plateau with +/-4 mV noise for an hour.
	let v = 2.600;
	for (let m = 0; m < 20; m++) {
		v += 0.002;
		api.parseMessage(obs(start + m * 60, v));
		states.push(api.currentReport.BatteryIsCharging);
	}
	assert.strictEqual(states[states.length - 1], true, 'steady charge is reported (first known state, no hold)');

	const plateau = v;
	for (let m = 20; m < 80; m++) {
		api.parseMessage(obs(start + m * 60, plateau + (m % 2 ? 0.004 : -0.004)));
		states.push(api.currentReport.BatteryIsCharging);
	}
	const changes = states.slice(1).filter((s, i) => s !== states[i]).length;
	assert.ok(changes <= 1, 'expected at most one change, got ' + changes);
	assert.strictEqual(api.currentReport.BatteryIsCharging, true);
});
