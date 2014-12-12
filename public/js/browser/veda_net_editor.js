/**
 * NET EDITOR
 * 
 * Inspired by http://github.com/hemantsshetty/jsWorkflow
 */


function getSubIndividual(net, property, id, func) {
	net[property].forEach(function(el) {
		if (el.id == id) {
			func(el);
		}
	});
}

function removeSubIndividual(net, property, id) {
	for (var i=0; i<net[property].length; i++) {
		if (net[property][i].id==id) {
			net[property].splice(i,1);
			return net[property];
		}
	}
	return net[property];
}

//[BEGIN] Block of net editor

var jsWorkflow = jsWorkflow || {};

// Leveraging the ready function of jsPlumb.
jsWorkflow.ready = jsPlumb.ready;

// Self execute this code
(function() {
    // No API call should be made until the DOM has been initialized.
    jsWorkflow.ready(function() {
        /**
         *Create a workflow instance.
         *@constructor Instance
         */
        jsWorkflow.Instance = function() {

            // Get a new instance of jsPlumb.
            this.instance = jsPlumb.getInstance();
        }
        /**
         *Initialize the workflow instance.
         *@method init
         *@param {String} workflowData Id of an HTML container within which the worlflow is to be rendered
         *@param {Object} workflowData A workflow object to render new workflow State elements in the DOM
         *return {Object} instance Returns an initialized instance of the workflow object
         */
        jsWorkflow.Instance.prototype.init = function(workflowData, veda, net) {

            var instance,
                    windows,
                    addNewState,
                    bindStateEvents,
                    workflow;

            if (typeof workflowData === 'object') {
                workflow = workflowData.container;
                jsWorkflow.Instance.createWorkflowDOM(workflowData);
            } else {
                workflow = workflowData;
            }

            instance = this.instance;

            // Import all the given defaults into this instance.
            instance.importDefaults({
                Endpoint: ["Dot", {
                        radius: 0.1
                    }],
                HoverPaintStyle: {
                    strokeStyle: "#6699FF",
                    lineWidth: 2
                },
                ConnectionOverlays: [
                    ["Arrow", {
                            location: 1,
                            id: "arrow",
                            length: 14,
                            foldback: 0.8
                        }],
                    ["Label", {
                            label: "transition",
                            id: "label",
                            cssClass: "aLabel"
                        }]
                ],
                Container: workflow // Id of the workflow container.
            });

            // Bind a click listener to each transition (connection). On double click, the transition is deleted.
            instance.bind("dblclick", function(transition) {            	 
                 if (confirm('Delete Flow?')) {
                	 net['v-wf:consistsOf'] = removeSubIndividual(net, 'v-wf:consistsOf', transition.id);
                	 instance.detach(transition);
                 }
            });
            
            // Fill info panel on flow click
            instance.bind("click", function(transition) {
            	var _this = this, currentElement = $(_this), properties;
                properties = $('#workflow-selected-item');
                $('#'+properties.find('#workflow-item-id').val()).removeClass('w_active');
                
                if (transition.id == '__label') {
                	transition = transition.component;
                }
                
                properties.find('#workflow-item-id').val(transition.id);
                properties.find('#workflow-item-type').val('flow');
                properties.find('#workflow-item-label').val(transition.getLabel());
                currentElement.addClass('w_active');                
               	$('.task-buttons').hide();
            });
            
            // Handle creating new flow event
            instance.bind("connection", function(info) {
            	if (info.connection.id.indexOf('con')==-1) {
            		return; // Don't use logic when we work with flows that already exists
            	}
                var individual = new veda.IndividualModel(); // create individual (Task / Condition) 
                individual.defineProperty("rdf:type");
                individual.defineProperty("rdfs:label");                
                individual.defineProperty("v-wf:flowsInto");
                
                individual["rdf:type"] = [veda.dictionary["v-wf:Flow"]];
                individual["rdfs:label"] = [new String('')];
                
                net['v-wf:consistsOf'] = net['v-wf:consistsOf'].concat([individual]); // <- Add new Flow to Net
                
                getSubIndividual(net, 'v-wf:consistsOf', info.sourceId, function(el) {
                	if (!('v-wf:hasFlow' in el)) {
        				el.defineProperty('v-wf:hasFlow');
        			}
        			el['v-wf:hasFlow'] = el['v-wf:hasFlow'].concat([individual]); // <- Add new Flow to State
                });
                
                getSubIndividual(net, 'v-wf:consistsOf', info.targetId, function(el) {
                	 individual["v-wf:flowsInto"] = [el]; // setup Flow source
                });
                
                info.connection.id = individual.id;
            });

            /**
             *Bind required functionalities to State elements
             *@method bindStateEvents
             *@param {Object} windows List of all State elements
             */
            bindStateEvents = function(windows) {

                // По клику переходим на свойства объекта
                windows.bind("click", function() {                	
                	
                	instance.repaintEverything();
                	
                    var _this = this, currentElement = $(_this), properties, itemId;
                    properties = $('#workflow-selected-item');
                                        
                    $('#'+escape4$(properties.find('#workflow-item-id').val())).removeClass('w_active'); // deactivate old selection
                    properties.find('#workflow-item-id').val(_this.id);
                    properties.find('#workflow-item-type').val('state');
                    properties.find('#workflow-item-label').val(currentElement.find('.state-name').text());

                    ["no", "and", "or", "xor"].forEach(function(entry) {
                        if (currentElement.hasClass('split-'+entry)) {
                        	$('#workflow-split-buttons label').removeClass('active').find('input').attr("checked",false);                        	
                        	$('input[name=item-split-type][value='+entry+']').attr("checked",true).parent().addClass('active');
                        }                        
                        if (currentElement.hasClass('join-'+entry)) {
                        	$('#workflow-join-buttons label').removeClass('active').find('input').attr("checked",false);                        	
                        	$('input[name=item-join-type][value='+entry+']').attr("checked",true).parent().addClass('active');
                        }
                    });          
                    if (currentElement.hasClass('state-condition')) {
                    	$('.task-buttons').hide();
                    } else {
                    	$('.task-buttons').show();
                    }
                    currentElement.addClass('w_active');
                });

                // Bind a click listener to each State elements. On double click, State elements are deleted.
                windows.bind("dblclick", function() {

                    var _this = this,
                            deleteState;

                    deleteState = confirm('Deleting State(' + $(_this).attr('id').toUpperCase() + ') ...');

                    if (deleteState) {

                        // remove all the connections of this State element.
                        instance.detachAllConnections(_this);

                        // remove the State element.
                        $(_this).remove();

                    } else {
                        return false;
                    }
                });

                // Initialize State elements as draggable.  
                instance.draggable(windows, {
              	  containment:"parent"
            	});

                // Initialize all State elements as Connection sources.
                instance.makeSource(windows, {
                    filter: ".ep",
                    anchor: ["Continuous", { faces:[ "top", "left", "right" ] } ],
                    connector: ["Bezier", {
                    	curviness: 0,
                        stub: 0
                    }],
                    connectorStyle: {
                        strokeStyle: "#666666",
                        lineWidth: 1,
                        outlineColor: "transparent",
                        outlineWidth: 4
                    },
                    maxConnections: 20,
                    onMaxConnections: function(info, e) {
                        alert("Maximum connections (" + info.maxConnections + ") reached");
                    }
                });

                // Initialize all State elements as connection targets.
                
                instance.makeTarget(windows, {
                    dropOptions: {
                        hoverClass: "dragHover"
                    }
                	,anchor: ["Continuous", { faces:[ "top", "left", "right" ] } ]
                });
            };

            // Add new State event.
            jsPlumb.getSelector(".create-state").bind("click", function() {
                var _this = this,
                        stateName,
                        stateId,
                        stateElement, 
                        individual = new veda.IndividualModel(); // create individual (Task / Condition) 
                                
                individual.defineProperty("rdf:type");
                individual.defineProperty("rdfs:label");
                individual.defineProperty("v-wf:locationX");
                individual.defineProperty("v-wf:locationY");

                stateName = prompt("Enter the name of the state");
                
                individual['rdfs:label'] = [new String(stateName.replace(/[^a-zA-Z0-9 ]/g, ''))];
                individual['v-wf:locationX'] = [new Number(0)];
                individual['v-wf:locationY'] = [new Number(0)];
                
                if ($("#workflow-canvas").find('#' + individual.id).length < 1) {

                   	if ($(_this).hasClass('create-condition')) {
                   		individual["rdf:type"] = [veda.dictionary["v-wf:Condition"]];
                    	instance.createState('v-wf:Condition', individual);
                    } else { 
                        individual["rdf:type"] = [veda.dictionary["v-wf:Task"]];
                    	instance.createState('v-wf:Task', individual);
                    }

                   	net['v-wf:consistsOf'] = net['v-wf:consistsOf'].concat([individual]); // <- Add new State to Net	
                    $('#' + individual.id).click();
                } else {
                    alert('This state is already present.');
                }
                $(this).blur();
            });

            /**
             *Get all State transitions
             *@method getStateTransitions A public method
             *@return {Object} workflowTransition List of all States and their transition (connection) with other States
             */
            instance.getStateTransitions = function() {
                var plumbConnections = instance.getAllConnections(),
                        connectionCount = plumbConnections.length,
                        workflowTransition = {},
                        sourceID,
                        targetID;

                for (var i = 0; i < connectionCount; i += 1) {

                    sourceID = plumbConnections[i]['sourceId'];
                    targetID = plumbConnections[i]['targetId'];

                    workflowTransition[sourceID] = (workflowTransition[sourceID]) ?
                            (workflowTransition[sourceID] + ',' + plumbConnections[i]['targetId']) :
                            plumbConnections[i]['targetId'];
                }
                return workflowTransition;
            }

            /**
             *Get all State names
             *@method getStateNames A public method
             *@return {Object} workflowStateName List of all State Element Ids with their respective names
             */
            instance.getStateNames = function() {
                var stateCount = windows.length,
                        workflowStateName = {};

                for (var i = 0; i < stateCount; i += 1) {

                    workflowStateName[$(windows[i]).attr('id')] = $(windows[i]).text().trim();
                }
                return workflowStateName;
            }

            /**
             *Get all State position
             *@method getStatePositions A public method
             *@return {Object} workflowStatePosition List of all State Element Ids with their respective css positions (top and left)
             */
            instance.getStatePositions = function() {

                // Get updates array of State elements.
                windows = jsPlumb.getSelector("." + workflow + " .w");                
                var stateCount = windows.length,
                        workflowStatePosition = {};

                for (var i = 0; i < stateCount; i += 1) {

                    workflowStatePosition[$(windows[i]).attr('id')] = $(windows[i]).position();
                }
                return workflowStatePosition;
            }

            /**
             *Get the workflow Object
             *@method getWorkflow A public method
             *@return {Object} workflow Current workflow object with details such as
             /* State transitions, State names, State positions and workflow container Id
             */
            instance.getWorkflow = function() {

                // Get updates array of State elements.
                windows = jsPlumb.getSelector("." + workflow + " .w");

                var workflowObject = {};

                workflowObject['transitions'] = instance.getStateTransitions();
                workflowObject['names'] = instance.getStateNames();
                workflowObject['positions'] = instance.getStatePositions();
                workflowObject['container'] = workflow;

                return workflowObject;
            }
            
            instance.getSplitJoinType = function(sj, type) {
            	if (type == null || type == undefined || type == '') {
            		return ' '+sj+'-no';
            	}
            	var res = 'no';
            	
            	if (type == 'v-wf:XOR')  return ' '+sj+'-xor';
            	if (type == 'v-wf:OR')   return ' '+sj+'-or';
            	if (type == 'v-wf:AND')  return ' '+sj+'-and';
            	if (type == 'v-wf:NONE') return ' '+sj+'-none';
            	
            	return ' '+sj+'-'+res;
            }
            
            // Add State to Workspace
            instance.createState = function(type, state) {
            	var stateElement = '';
            	switch (type) {
    			case 'v-wf:InputCondition':    				
    				stateElement = '<div class="w state-condition" id="' + state.id + '" style="font-size:20px;padding-top:10px;left: ' + 2*state['v-wf:locationX'][0] + 'px; top: ' + 2*state['v-wf:locationY'][0] + 'px;"><div><span class="glyphicon glyphicon-play" aria-hidden="true"></div><div class="ep"></div></div>';
    				break;
    			case 'v-wf:OutputCondition':
    				stateElement = '<div class="w state-condition" id="' + state.id + '" style="font-size:20px;padding-top:10px;left: ' + 2*state['v-wf:locationX'][0] + 'px; top: ' + 2*state['v-wf:locationY'][0] + 'px;"><div><span class="glyphicon glyphicon-stop" aria-hidden="true"></div></div>';
    				break;
    			case 'v-wf:Condition':
    				stateElement = '<div class="w state-condition" id="' + state.id + '" style="left: ' + 2*state['v-wf:locationX'][0] + 'px; top: ' + 2*state['v-wf:locationY'][0] + 'px;"><div class="state-name"></div><div class="ep"></div></div>';
    				break;
    			case 'v-wf:Task':
            		stateElement = '<div class="w state-task split-join '
            			+ instance.getSplitJoinType('split', state['v-wf:split']!=null?state['v-wf:split'][0].id:null)
            			+ instance.getSplitJoinType('join', state['v-wf:join']!=null?state['v-wf:join'][0].id:null)
            			+ '" id="' + state.id + '" style="left: ' 
            			+ 2*state['v-wf:locationX'][0] + 'px; top: ' 
            			+ 2*state['v-wf:locationY'][0] + 'px;"><div class="state-name">' + state['rdfs:label'][0] + '</div><div class="ep"></div></div>';
    				break;
    			}
            	if (stateElement!='') {
                	$("#workflow-canvas").append(stateElement);
                	bindStateEvents($('#' + escape4$(state.id)));
                	updateSVGBackground($('#' + escape4$(state.id)));
            	}
            }
            
            instance.createFlow = function(state, flow) {
            	var connector = instance.connect({
            		id: flow.id,
                    source: state.id,
                    target: flow['v-wf:flowsInto'][0].id
                });
            }

            /**
             *Create workflow Net by given Object (v-wf:Net individual).
             *@method createNet A public method
             *@param {Object} workflowData A workflow object to create State transitions
             */
            instance.createNet = function(net) {
            	$('#workflow-net-name').text(net['rdfs:label'][0]);
            	// Create States
            	net['v-wf:consistsOf'].forEach(function(el) {
            		el['rdf:type'].forEach(function (type) {
            			instance.createState(type.id, el);
            		});
            	});
            	
            	// Create Flows
            	net['v-wf:consistsOf'].forEach(function(el) {
            		if (undefined != el['v-wf:hasFlow']) {
            			el['v-wf:hasFlow'].forEach(function (flow) {
            				instance.createFlow(el, flow);
            			});
            		}
            	});
            }
            instance.createNet(net);
            
            $('#workflow-save-button').on('click', function() {
            	alert(net);
            	net.save();
            	net['v-wf:consistsOf'].forEach(function(el) {
            		el.save();
            	});
            });
            
            return instance;
        }
        /**
         *Create the workflow DOM from the given data.
         *@method createWorkflowDOM
         *@param {Object} workflowData A workflow object to render new workflow State elements in the DOM
         */
        /*
        jsWorkflow.Instance.createWorkflowDOM = function(workflowData) {

            var container = workflowData.container,
                    names = workflowData.names,
                    positions = workflowData.positions,
                    elements = '';

            for (var name in names) {
                if (names.hasOwnProperty(name)) {
                    elements += '<div class="w wwww state split-join" id=' + name + ' style="left: ' + positions[name]['left'] + 'px; top: ' + positions[name]['top'] + 'px;">' + names[name] + '<div class="ep"></div></div>';
                }
            }

            $('#' + container).append(elements);
        }*/
    });
})();

//[END] Block of net editor

// [BEGIN] Block of element editor

function updateSVGBackground(item) {
    var svgBackground = "";
    if (item.hasClass('split-and')) {
        svgBackground += "<line x1='80' y1='25' x2='100' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='80' y1='0' x2='80' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='80' y1='25' x2='100' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    if (item.hasClass('split-or')) {
        svgBackground += "<line x1='100' y1='25' x2='90' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='90' y1='0' x2='80' y2='25' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='80' y1='0' x2='80' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='100' y1='25' x2='90' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='90' y1='50' x2='80' y2='25' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    if (item.hasClass('split-xor')) {
        svgBackground += "<line x1='100' y1='25' x2='80' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='80' y1='0' x2='80' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='100' y1='25' x2='80' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    if (item.hasClass('join-and')) {
        svgBackground += "<line x1='20' y1='25' x2='0' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='20' y1='0' x2='20' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='20' y1='25' x2='0' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    if (item.hasClass('join-or')) {
        svgBackground += "<line x1='0' y1='25' x2='10' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='10' y1='0' x2='20' y2='25' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='20' y1='0' x2='20' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='0' y1='25' x2='10' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='10' y1='50' x2='20' y2='25' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    if (item.hasClass('join-xor')) {
        svgBackground += "<line x1='0' y1='25' x2='20' y2='0' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='20' y1='0' x2='20' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' /><line x1='0' y1='25' x2='20' y2='50' style='stroke:rgb(0,0,0); stroke-width:1' />";
    }
    svgBackground = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' version='1.1' preserveAspectRatio='none' viewBox='0 0 100 50'>" + svgBackground + "</svg>\")";
    item.css('background', svgBackground);
}

function applyNetEditorFunctions(workflow) {
  // Label
  $("#workflow-item-label").change(function () {
	var _this = this;
	switch ($('#workflow-item-type').val()) {
		case 'state':
			var item = $('#' + escape4$($('#workflow-item-id').val()));
			item.find('.state-name').text($(this).val());
			break;
		case 'flow':			
			var id=$('#workflow-item-id').val();
			workflow.getAllConnections().forEach(function (conn) {
				if (conn.id == id) {
					conn.setLabel($(_this).val());
				}
			});
			
			break;
	}
  });
	
  // Split type
  $("input[name=item-split-type]:radio").change(function () {
    var item = $('#' + escape4$($('#workflow-item-id').val()));    
    item.removeClass('split-no split-and split-or split-xor');
    item.addClass('split-' + $(this).val());
    updateSVGBackground(item);
  });

  // Join type
  $("input[name=item-join-type]:radio").change(function () {
    var item = $('#' + escape4$($('#workflow-item-id').val()));
    item.removeClass('join-no join-and join-or join-xor');
    item.addClass('join-' + $(this).val());
    updateSVGBackground(item);
  });
}
// [END] Block of element editor