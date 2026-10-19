var MAX_DIMENSION = 4096;
var MAX_QUALITY = 100;
var IMG_PREFIX = "/img/";
var ORDER = ["w", "h", "c", "g", "b", "q", "f"];
var CROP_MODES = ["pad", "fit", "fill", "limit"];
var GRAVITIES = ["center", "north", "south", "east", "west", "northeast", "northwest", "southeast", "southwest"];
var FORMATS = ["jpg", "png", "webp", "avif"];
var TOKEN = /^([a-z])_(.+)$/;
var INTEGER = /^[1-9][0-9]{0,3}$/;
var HEX = /^[0-9a-f]{6}$/;
var KEY = /^[a-z0-9-]+\/(media|files)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
var DENIED_SEGMENTS = ["sources", "uploads", ".", ".."];
var DEFAULT_VALUES = { c: "fit" };

function inRange(value, max) {
	return INTEGER.test(value) && Number(value) <= max;
}

function validValue(name, value) {
	if (name === "w" || name === "h") {
		return inRange(value, MAX_DIMENSION);
	}
	if (name === "q") {
		return inRange(value, MAX_QUALITY);
	}
	if (name === "c") {
		return CROP_MODES.indexOf(value) !== -1;
	}
	if (name === "g") {
		return GRAVITIES.indexOf(value) !== -1;
	}
	if (name === "b") {
		return HEX.test(value);
	}
	return FORMATS.indexOf(value) !== -1;
}

function canonicalParams(segment) {
	var raw = {};
	var tokens = segment.split(",");
	for (var i = 0; i < tokens.length; i++) {
		var match = TOKEN.exec(tokens[i]);
		if (match === null || ORDER.indexOf(match[1]) === -1 || raw[match[1]] !== undefined) {
			return null;
		}
		if (!validValue(match[1], match[2])) {
			return null;
		}
		raw[match[1]] = match[2];
	}
	if (raw.w === undefined && raw.h === undefined) {
		return null;
	}
	if (raw.b !== undefined && raw.c !== "pad") {
		return null;
	}
	if (raw.g !== undefined && raw.c !== "fill") {
		return null;
	}
	var parts = [];
	for (var j = 0; j < ORDER.length; j++) {
		if (raw[ORDER[j]] !== undefined && raw[ORDER[j]] !== DEFAULT_VALUES[ORDER[j]]) {
			parts.push(ORDER[j] + "_" + raw[ORDER[j]]);
		}
	}
	return parts.join(",");
}

function transformableKey(key) {
	if (!KEY.test(key)) {
		return false;
	}
	var segments = key.split("/");
	for (var i = 0; i < segments.length; i++) {
		if (DENIED_SEGMENTS.indexOf(segments[i]) !== -1) {
			return false;
		}
	}
	return true;
}

function badRequest() {
	return {
		statusCode: 400,
		statusDescription: "Bad Request",
		headers: { "content-type": { value: "text/plain; charset=utf-8" } },
		body: { encoding: "text", data: "Invalid image request" }
	};
}

function redirect(path, querystring) {
	var version = querystring && querystring.v ? "?v=" + encodeURIComponent(querystring.v.value) : "";
	return {
		statusCode: 301,
		statusDescription: "Moved Permanently",
		headers: { location: { value: path + version } }
	};
}

function handler(event) {
	var request = event.request;
	var uri = request.uri;
	if (uri.indexOf(IMG_PREFIX) !== 0) {
		return request;
	}
	var rest = uri.slice(IMG_PREFIX.length);
	var slash = rest.indexOf("/");
	if (slash === -1) {
		return badRequest();
	}
	var segment = rest.slice(0, slash);
	var key = rest.slice(slash + 1);
	var canonical = canonicalParams(segment);
	if (canonical === null || !transformableKey(key)) {
		return badRequest();
	}
	if (canonical !== segment) {
		return redirect(IMG_PREFIX + canonical + "/" + key, request.querystring);
	}
	request.uri = "/" + key + "/_img/" + canonical;
	return request;
}

if (typeof module !== "undefined") {
	module.exports = { handler };
}
