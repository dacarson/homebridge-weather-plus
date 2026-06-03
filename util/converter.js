/*jshint esversion: 6,node: true,-W041: false */
"use strict";

const getWindDirection = function (degree)
{
	if (typeof degree !== 'number' || isNaN(degree))
	{
		return 'Unkown';
	}
	let cat = Math.round(degree % 360 / 22.5);
	let dir;

	// TODO multilanguage
	switch (cat)
	{
		case 0:
			dir = 'N';
			break;
		case 1:
			dir = 'NNE';
			break;
		case 2:
			dir = 'NE';
			break;
		case 3:
			dir = 'ENE';
			break;
		case 4:
			dir = 'E';
			break;
		case 5:
			dir = 'ESE';
			break;
		case 6:
			dir = 'SE';
			break;
		case 7:
			dir = 'SSE';
			break;
		case 8:
			dir = 'S';
			break;
		case 9:
			dir = 'SSW';
			break;
		case 10:
			dir = 'SW';
			break;
		case 11:
			dir = 'WSW';
			break;
		case 12:
			dir = 'W';
			break;
		case 13:
			dir = 'WNW';
			break;
		case 14:
			dir = 'NW';
			break;
		case 15:
			dir = 'NNW';
			break;
		case 16:
			dir = 'N';
			break;
		default:
			dir = 'Variable';
	}
	return dir;
};

const getRainAccumulated = function (array)
{
	let sum = 0.0;
	for (let i = 0; i < array.length; i++)
	{
		sum += parseFloat(array[i]);
	}
	return sum;
};

	// Calculate Wet Bulb Temperature
	// @see https://www.omnicalculator.com/physics/wet-bulb
const getWetBulbTemperature = function (dryBulbTemperature, relativeHumidity)
{
	let T = dryBulbTemperature;
	let rh = relativeHumidity;

	let c1 = 0.152;
	let c2 = 8.3136;
	let c3 = 0.5;
	let c4 = 1.6763;
	let c5 = 0.00391838;
	let c6 = 1.5;
	let c7 = 0.0231;
	let c8 = 4.686;

	let Tw = T * Math.atan(c1 * Math.pow((rh + c2), c3)) +
		Math.atan(T+rh) - Math.atan(rh-c4) +
		c5 * Math.pow(rh, c6) * Math.atan(c7 * rh) - c8;

	return Tw;
}

// Maintains a rolling pressure history and returns the ~3-hour pressure delta.
// history: array of {ts, pressure}, mutated in place (pass this.pressureHistory).
// pressure: current pressure in hPa.
// Returns hPa change over ~3 hours (positive = rising). Returns 0 until any
// history exists; before 3 hours have elapsed, uses the oldest available reading
// as the reference, which gives a proportionally smaller (but valid) delta.
function trackPressureDelta(history, pressure) {
	const now = Date.now();
	const THREE_HOURS_MS = 3 * 3600 * 1000;
	const WINDOW_MS = 3.5 * 3600 * 1000;

	// Drop entries older than 3.5 hours
	const cutoff = now - WINDOW_MS;
	while (history.length > 0 && history[0].ts < cutoff) history.shift();

	let delta = 0;
	if (history.length > 0) {
		// Find reading closest to 3 hours ago; falls back to oldest available
		// until 3 hours of history accumulate.
		const target = now - THREE_HOURS_MS;
		const ref = history.reduce((best, e) =>
			Math.abs(e.ts - target) < Math.abs(best.ts - target) ? e : best,
			history[0]);
		delta = pressure - ref.pressure;
	}

	history.push({ ts: now, pressure });
	return delta;
}

// Simple Zambretti pressure forecaster.
// Stop-gap until weather-formulas ships native Zambretti support:
// https://github.com/oyve/weather-formulas/issues/46
//
// pressureDelta: hPa change over ~3 hours (positive = rising, negative = falling).
// Returns a letter A–Z representing the Zambretti forecast.
function zambrettiLetter(pressureDelta) {
	if (pressureDelta > 1.6)  return 'A'; // Rising fast  → Settled fine
	if (pressureDelta > 0.5)  return 'B'; // Rising       → Fine weather
	if (pressureDelta > -0.5) return 'F'; // Steady       → Fine, becoming less settled
	if (pressureDelta > -1.6) return 'N'; // Falling      → Rather unsettled
	return 'S';                            // Falling fast → Stormy, much rain
}

// Maps Zambretti letter to base Eve trend value.
// Bit 2 = rain, bits 1:0 = sky condition when no rain.
// Wind (bit 3) is applied separately from live wind speed.
const ZAMBRETTI_TO_BASE = {
	// Clear sky
	'A': 1, 'B': 1, 'C': 1, 'D': 1,
	// Partly cloudy
	'E': 3, 'F': 3, 'G': 3, 'H': 3, 'I': 3,
	'J': 3, 'K': 3, 'L': 3, 'M': 3, 'N': 3,
	// Rain
	'O': 4, 'P': 4, 'Q': 4, 'R': 4, 'S': 4,
	'T': 4, 'U': 4, 'V': 4,
	'W': 4, 'X': 4, 'Y': 4, 'Z': 4,
};

// Wind speed threshold above which bit 3 (wind flag) is set.
// 10 m/s ≈ 22 mph = Beaufort 5 "Fresh breeze".
const EVE_WIND_THRESHOLD_MS = 10;

// Compute the Eve Weather Trend characteristic value (0–15).
// pressureDelta: hPa change since last reading (positive = rising).
// windSpeedMs: wind speed in m/s, or null to skip the wind bit.
function computeEveTrend(pressureDelta, windSpeedMs) {
	const letter  = zambrettiLetter(pressureDelta);
	const base    = ZAMBRETTI_TO_BASE[letter] || 0;
	const windBit = (windSpeedMs !== null &&
	                 windSpeedMs !== undefined &&
	                 windSpeedMs >= EVE_WIND_THRESHOLD_MS) ? 8 : 0;
	return base | windBit;
}

module.exports = {
	getWindDirection,
	getRainAccumulated,
	getWetBulbTemperature,
	trackPressureDelta,
	computeEveTrend
};
