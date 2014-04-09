// Console Model

function Console() { "use strict";
	var self = $.observable(this);
	self.id = "" + Math.random() * 0x10000;
	self.script = self.runat = self.result = self.output = "";
	self.start = self.stop = 0;
	self.run = function() {
		self.trigger("run");
		if (self.runat == "server") {
			execute_script(self.script, function(res) {
				self.result = res[0];
				self.output = res[1];
				self.trigger("done");
			});
		} else {
			var res = eval(self.script);
			self.result = res;
			self.output = "";
			self.trigger("done");
		}
	}
	self.on("run", function() {
		self.start = new Date().getTime();
	});
	self.on("done", function() {
		self.stop = new Date().getTime();
	});
};