module.exports = {
	process: (source) => ({ code: `module.exports = ${JSON.stringify(source)};` })
};
