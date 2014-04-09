// Module registrator

function Module(module, parent, name) {
	module._name = name;
	module._id = guid();
	module._path = parent ? parent._path + "." + module._name : module._name;
	module._register = function(new_module) {
		module[new_module._name] = new_module;
	}
	module.trigger("ready");
	if (!parent) return module;
	parent.on("ready", parent._register(module));
};
