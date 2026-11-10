const Module = require("module");

const original = Module.prototype.require;
Module.prototype.require = function stubServerOnly(id) {
  if (id === "server-only") return {};
  return original.apply(this, arguments);
};
