"use strict";

/*
	Charging State smoothing for WeatherFlow stations.

	WeatherFlow does not report a charging flag, so the plugin infers it from
	the battery voltage trend. Comparing each 1-minute reading against the
	previous one flaps constantly, because the voltage is reported in 1 mV
	steps and normal sensor noise moves it up and down by a few mV between
	readings. Two stages fix that:

	1. BatteryVoltageTrend: voltage changes within a deadband count as
	   "no change". The reference voltage only moves when the deadband is
	   exceeded, so a slow real charge or discharge still accumulates and is
	   detected.
	2. ChargingStateHold: a new state is only reported once it has held for
	   CHARGING_STATE_HOLD_MS of consecutive readings. The first known state
	   after startup is reported immediately.
*/

// A Charging State change must hold this long before it is reported.
const CHARGING_STATE_HOLD_MS = 15 * 60 * 1000;

// Voltage changes of this size or smaller (in volts) are treated as noise.
// 10 mV is about 1.4% on the Tempest battery scale.
const BATTERY_VOLTAGE_DEADBAND = 0.010;

class BatteryVoltageTrend
{
	constructor(deadband = BATTERY_VOLTAGE_DEADBAND)
	{
		this.deadband = deadband;
		this.reference = undefined;
		this.charging = undefined;
	}

	// Returns true (charging), false (not charging), or undefined while the
	// trend is still unknown (e.g. right after startup).
	update(voltage)
	{
		if (typeof voltage !== 'number' || !isFinite(voltage)) return this.charging;

		if (this.reference === undefined) {
			this.reference = voltage;
			return this.charging;
		}

		const delta = voltage - this.reference;
		if (Math.abs(delta) > this.deadband) {
			this.charging = delta > 0;
			this.reference = voltage;
		}
		return this.charging;
	}
}

class ChargingStateHold
{
	// debugLog is optional and is called with a message whenever a change is held back.
	constructor(holdMs = CHARGING_STATE_HOLD_MS, debugLog)
	{
		this.holdMs = holdMs;
		this.debugLog = debugLog;
		this.reported = undefined;
		this.pending = undefined;
		this.pendingSince = undefined;
	}

	// state: the latest raw state (undefined = unknown, ignored).
	// timestampMs: time of the reading the state came from.
	// Returns the state that should be reported (undefined until the first known state).
	update(state, timestampMs)
	{
		if (state === undefined) return this.reported;

		// Startup: report the first known state immediately.
		if (this.reported === undefined) {
			this.reported = state;
			return this.reported;
		}

		if (state === this.reported) {
			this.pending = undefined;
			this.pendingSince = undefined;
			return this.reported;
		}

		if (this.pending !== state) {
			this.pending = state;
			this.pendingSince = timestampMs;
		}

		const heldMs = timestampMs - this.pendingSince;
		if (heldMs >= this.holdMs) {
			this.reported = state;
			this.pending = undefined;
			this.pendingSince = undefined;
			return this.reported;
		}

		if (this.debugLog) {
			this.debugLog("Holding back Charging State change to " + (state ? "CHARGING" : "NOT_CHARGING") +
				" (held " + Math.round(heldMs / 1000) + "s of " + Math.round(this.holdMs / 1000) + "s)");
		}
		return this.reported;
	}
}

module.exports = {
	CHARGING_STATE_HOLD_MS,
	BATTERY_VOLTAGE_DEADBAND,
	BatteryVoltageTrend,
	ChargingStateHold
};
