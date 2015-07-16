/**
 * @class veda.IndividualModel 
 * 
 * This class is used to manipulate with individuals.
 */
veda.Module(function (veda) { "use strict";

	/**
	 * @constructor
	 * @param {String} uri URI of individual. If not specified, than id of individual will be generated automatically. 
	 * @param {String/jQuery} container Container to render individual in. If passed as String, then must be a valid css selector. If passed as jQuery, then is used as is. If not specified, than individual will not be presented.
	 * @param {String/jQuery/veda.IndividualModel} template Template to render individual with.
	 * @param {String} mode Initial mode for individual presenter. Expected values: "view", "edit", "search".
	 * @param {boolean} cache Use cache true / false. If true or not set, then object will be return from application cache (veda.cache). If false or individual not found in application cache - than individual will be loaded from database 
	 * @param {boolean} init individual with class model at load. If true or not set, then individual will be initialized with class specific model upon load.
	 */
	veda.IndividualModel = function (uri, container, template, mode, cache, init) {
	
		var self = riot.observable(this);
		
		// Define Model functions
		self._ = {};
		self._.cache = typeof cache !== "undefined" ? cache : true;
		self._.init = typeof init !== "undefined" ? init : true;
		self._.individual = {};
		self._.original_individual = "{}";
		self._.properties = {};
		self._.values = {};		
		self._.sync = false;
		self.properties = {};
		
		if (!uri) { 
			self._.individual["@"] = guid();
			self._.original_individual = '{"@":"' + self._.individual["@"] +'"}';
			if (self._.cache && veda.cache) {
				veda.cache[self._.individual["@"]] = self;
			}
		}

		// Special properties
		Object.defineProperty(self, "id", {
			get: function () { 
				return self._.individual["@"];
			},
			set: function (value) { 
				self._.sync = false;
				self._.individual["@"] = value;
				self.trigger("individual:idChanged", value);
			}
		});

		var rights;
		Object.defineProperty(self, "rights", {
			get: function () { 
				if (rights) return rights;
				try {
					var rightsJSON = get_rights(veda.ticket, self.id);
					rights = new veda.IndividualModel( rightsJSON );
				} catch (e) {
					rights = null;
				} finally {
					return rights;
				}
			},
			configurable: false
		});

		self.defineProperty("rdf:type", undefined, function (classes) {
			self._.sync = false;
			self.init();
			self.trigger("individual:typeChanged", classes);
		});

		self.defineProperty("v-s:deleted");
		
		self.on("individual:afterLoad", function (individual) {
			self.present.call(individual, container, template, mode);
		});
		
		self.on("individual:typeChanged", function () {
			self.present(container, template, mode);
		});
		
		// Load data 
		if (uri) self = self.load(uri);
		else self.trigger("individual:afterLoad", self);

		return self;
	};

	var proto = veda.IndividualModel.prototype;

	/**
	 * @method
	 * 
	 * You must define property in individual  
	 * 
	 * @param {String} property_uri name of property
	 * @param {Function} getterCB callback function that called after get method executed
	 * @param {Function} setterCB callback function that called after set method executed
	 */
	proto.defineProperty = function (property_uri, getterCB, setterCB) {
		var self = this;
		if (self._.properties[property_uri]) return this;
		
		Object.defineProperty(self.properties, property_uri, {
			get: function () { 
				if (self._.properties[property_uri]) return self._.properties[property_uri];
				try { self._.properties[property_uri] = new veda.IndividualModel(property_uri); } 
				catch (e) { self._.properties[property_uri] = property_uri; }
				return self._.properties[property_uri];
			},
			
			set: function (value) { 
				if (self._.properties[property_uri] == value) return; 
				self._.properties[property_uri] = value; 
			},
			
			configurable: true
		
		});
		
		var filteredStrings = [];
		self._.values[property_uri] = undefined;
		
		Object.defineProperty(self, property_uri, {
			get: function () { 
				if (self._.values[property_uri]) return self._.values[property_uri];
				if (!self._.individual[property_uri]) self._.individual[property_uri] = [];
				self._.values[property_uri] = self._.individual[property_uri].map( parser );
				// Filter undesired language tagged strings && undefined values
				self._.values[property_uri] = self._.values[property_uri]
					.filter(function (i) { return !!i; })
					.filter(function (string) {
						if (! (string instanceof String) ) return true;
						return (string.language === undefined || (veda.user && veda.user.language && string.language in veda.user.language)) ? (
							true
						) : (
							filteredStrings.push(string),
							false
						);
					});
				if (getterCB) getterCB(self._.values[property_uri]);
				return self._.values[property_uri];
			},
			
			set: function (value) { 
				self._.sync = false;
				self._.values[property_uri] = value.filter(function (i) { return !!i; });
				self._.individual[property_uri] = self._.values[property_uri].concat(filteredStrings).map( serializer );
				if (setterCB) setterCB(self._.values[property_uri]);
			},
			
			configurable: true
		
		});
		return this;
	};

	function parser(value) {
		if (value.type === "String") {
			var string = new String(value.data);
			string.language = value.lang === "NONE" ? undefined : value.lang;
			return string;
		} 
		else if (value.type === "Uri") {
			if (value.data.search(/^.{3,5}:\/\//) === 0) return new String(value.data);
			return new veda.IndividualModel(value.data);
		} 
		else if (value.type === "Datetime") return new Date(Date.parse(value.data));
		else if (value.type === "Decimal") return new Number(value.data);
		else if (value.type === "Integer") return new Number(value.data);
		else if (value.type === "Boolean") return new Boolean(value.data);
		else throw ("Unsupported type of property value");
	}
	
	function serializer (value) {
		var result = {};
		if (value instanceof Number || typeof value === "number" ) {
			result.type = isInteger(value.valueOf()) ? "Integer" : "Decimal";
			result.data = value.valueOf();
			return result;
		} else if (value instanceof Boolean || typeof value === "boolean") {
			result.type = "Boolean";
			result.data = value.valueOf();
			return result;
		} else if (value instanceof String || typeof value === "string") {
			result.type = "String";
			result.data = value.valueOf();
			result.lang = value.language || "NONE";
			return result;
		} else if (value instanceof Date) {
			result.type = "Datetime";
			result.data = value.toISOString();
			return result;
		} else if (value instanceof veda.IndividualModel) {
			result.type = "Uri";
			result.data = value.id;
			return result;
		} else {
			return value;
		}
	}	

	function isInteger (n) { return n % 1 === 0; }
		
	/**
	 * @method
	 * Load individual specified by uri from database. If cache parameter (from constructor) is true, than try to load individual from browser cache first.
	 * @param {String} uri individual uri
	 */
	proto.load = function (uri) {
		var self = this;
		self.trigger("individual:beforeLoad");
		if (typeof uri === "string") {
			if (self._.cache && veda.cache[uri]) {
				self.trigger("individual:afterLoad", veda.cache[uri]);
				return veda.cache[uri]; 
			}
			try {
				self._.individual = get_individual(veda.ticket, uri);
				self._.sync = true;
			} catch (e) {
				self._.individual = {
					"@": uri,
					"rdfs:label": [{type: "String", data: uri, lang: "NONE"}]
				};
			}
		} else if (uri instanceof veda.IndividualModel) {
			self.trigger("individual:afterLoad", uri);
			return uri;
		} else {
			self._.individual = uri;
		}
		self._.original_individual = JSON.stringify(self._.individual);
		Object.keys(self._.individual).map(function (property_uri) {
			if (property_uri === "@") return;
			if (property_uri === "rdf:type") return;
			if (property_uri === "v-s:deleted") return;
			self.defineProperty(property_uri, undefined, function (values) {
				self.trigger("individual:propertyModified", property_uri, values);
			});
		});
		if (self._.cache) veda.cache[self.id] = self;
		if (self._.init) self.init();
		self.trigger("individual:afterLoad", self);
		return this;
	};

	/**
	 * @method
	 * Save current individual to database
	 */
	proto.save = function() {
		var self = this;
		if (self._.sync) return;
		self.trigger("individual:beforeSave");
		Object.keys(self._.individual).reduce(function (acc, property_uri) {
			if (property_uri === "@") return acc;
			acc[property_uri] = self._.individual[property_uri].filter(function (item) {
				return item && item.data !== "";
			});
			if (!acc[property_uri].length) delete acc[property_uri];
			return acc;
		}, self._.individual);
		try { 
			put_individual(veda.ticket, self._.individual);
			self._.original_individual = JSON.stringify(self._.individual);
			self._.sync = true;
			self.trigger("individual:afterSave", self._.original_individual);
		} catch (e) {
			alert("Error: " + e.status + "\n" + "description: " + e.description);
		}
		return this;
	};

	/**
	 * @method
	 * Reset current individual to database
	 */
	proto.reset = function () {
		var self = this;
		self.trigger("individual:beforeReset");
		var original = JSON.parse(self._.original_individual);
		Object.keys(original).map(function (property_uri) {
			if (property_uri === "@") return;
			if (property_uri === "rdf:type") return;
			self[property_uri] = original[property_uri].map( parser );
		});
		self._.sync = true;
		self.trigger("individual:afterReset");
		return this;
	};

	/**
	 * @method
	 * Mark current individual as deleted in database (add v-s:deleted property)
	 */
	proto.delete = function () {
		this.trigger("individual:beforeDelete");
		this["v-s:deleted"] = [new Boolean(true)];
		this.save();
		this.trigger("individual:afterDelete");
		return this;
	};

	/**
	 * @method
	 * Recover current individual in database (remove v-s:deleted property)
	 */
	proto.recover = function () {
		this.trigger("individual:beforeRecover");
		this["v-s:deleted"] = [];
		this.save();
		this.trigger("individual:afterRecover");
		return this;
	};

	/**
	 * @method
	 * @param {String} property_uri property name
	 * @return {boolean} is requested property exists in this individual
	 */
	proto.hasValue = function (property_uri) {
		return !!(this[property_uri] && this[property_uri].length);
	};

	/**
	 * @method
	 * Initialize individual with class specific domain properties and methods
	 */
	proto.init = function () {
		var self = this;
		self["rdf:type"].map(function (_class) {
			if (_class.domainProperties) {
				Object.keys(_class.domainProperties).map(function (property_uri) {
					if (property_uri === "rdf:type") return;
					if (property_uri === "v-s:deleted") return;
					self.defineProperty(property_uri, undefined, function (values) {
						self.trigger("individual:propertyModified", property_uri, values);
					});
				});
			}
			if (_class.model) {
				var model = new Function (
					"individual", 
					_class.model["v-s:script"][0] + "//# sourceURL=" + _class.id + "Model.js"
				);
				model(self);
			}
		});
		return this;
	};

	/**
	 * @method
	 * Clone individual with different (generated) id
	 * @return {veda.IndividualModel} clone of this individual with different id.
	 */
	proto.clone = function () {
		var self = this;
		var clone = new veda.IndividualModel();
		Object.getOwnPropertyNames(self.properties).map( function (property_uri) {
			if (property_uri === "rdf:type") return;
			if (property_uri === "v-s:deleted") return;
			clone.defineProperty(property_uri, undefined, function (values) {
				clone.trigger("individual:propertyModified", property_uri, values);
			});
			clone[property_uri] = self[property_uri].slice(0);
		});
		clone["rdf:type"] = self["rdf:type"].slice(0);
		clone["v-s:deleted"] = self["v-s:deleted"].slice(0);
		return clone;
	};

	/**
	 * @method
	 * Check whether individual is synchronized with db
	 * @return {boolean}
	 */
	proto.isSync = function () {
		return self._.sync;
	};

	/**
	 * @method
	 * Call indivdual presenter
	 * @param {String/jQuery} container Container to render individual in. If passed as String, then must be a valid css selector. If passed as jQuery, then is used as is. If not specified, than individual will not be presented.
	 * @param {String/jQuery/veda.IndividualModel} template Template to render individual with.
	 * @param {String} mode Initial mode for individual presenter. Expected values: "view", "edit", "search".
	 */
	proto.present = function (container, template, mode) {
		if (container) veda.trigger("individual:loaded", this, container, template, mode);
		return this;
	};
	
});
