/*
 * spin.js
 *  https://github.com/SIDN/spin/html/js/spin.js
 *
 * @version 0.0.1
 * @date 2017-02-24
 *
 * SPIN Graphical module
 * Main functionality: Maintain the dashboard, in particular the VisJS graphs
 *
 */
"use strict";

var traffic_dataset = new vis.DataSet([]);
var graph2d_1;
var selectedNodeId;
// list of filters
var filterList = [];
// feed this data from websocket command
var zoom_locked = false;

var colour_src = "#dddddd";
var colour_dst = "lightblue";
var colour_recent = "#bbffbb";
var colour_edge = "#9999ff";
var colour_blocked = "#ff0000";

// these are used in the filterlist dialog
var _selectRange = false,
    _deselectQueue = [];

function enableZoomLock() {
    updateZoomLock(true);
}

function toggleZoomLock() {
    updateZoomLock(!zoom_locked);
}

function updateZoomLock(newBool) {
    zoom_locked = newBool;
    if (zoom_locked) {
        $("#autozoom-button").button("option", {
            "icons": {
                "primary": "ui-icon-locked"
            },
            "label": "Unlock view"
        });
    } else {
        $("#autozoom-button").button("option", {
            "icons": {
                "primary": "ui-icon-unlocked"
            },
            "label": "Lock view"
        });
    }
}

// code to add filters
function sendAddFilterCommand(nodeId) {
    var node = nodes.get(nodeId);
    if ("ips" in node) {
        for (var i = 0; i < node.ips.length; i++) {
            filterList.push(node.ips[i]);
        }
    }

    sendCommand("add_filter", nodeId); // talk to websocket
    deleteNodeAndConnectedNodes(node);
}

function updateFilterList() {
    $("#filter-list").empty();
    for (var i = 0; i < filterList.length; i++) {
        var li = $("<li class='ui-widget-content'></li> ").text(filterList[i]);
        $("#filter-list").append(li);
    }
}

function initGraphs() {
    $("#new-filter-dialog").hide();
    $("#rename-dialog").hide();
    $("#autozoom-button").button({
        "icons": {
            "primary": "ui-icon-unlocked"
        },
        "label": "Lock view"
    }).click(toggleZoomLock);

    // create the node information dialog
    $("#nodeinfo").dialog({
        autoOpen: false,
        position: {
            my: "left top",
            at: "left top",
            of: "#mynetwork"
        }
    });

    // create the ignore node dialog
    $(function() {
        var dialog;

        dialog = $("#new-filter-dialog").dialog({
            autoOpen: false,
            resizable: false,
            height: "auto",
            width: 400,
            modal: true,
            buttons: {
                "Ignore node": function() {
                    sendAddFilterCommand(selectedNodeId);
                    $(this).dialog("close");
                },
                Cancel: function() {
                    $(this).dialog("close");
                }
            }
        });
        $("#add-filter-button").button().on("click", function() {
            dialog.dialog("open");
        });
    });

    // create the rename dialog
    $(function() {
        var name = $("#rename-field");
        var dialog;
        var allFields = $([]).add(name);

        function renameNode() {
            var argument = {};
            var node = nodes.get(selectedNodeId);
            var newname = name.val();
            argument['node_id'] = selectedNodeId;
            argument['name'] = newname;
            sendCommand("add_name", argument); // talk to Websocket

            node.label = newname;
            nodes.update(node);
        }

        dialog = $("#rename-dialog").dialog({
            autoOpen: false,
            width: 380,
            modal: true,
            buttons: {
                "Rename node": submitted,
                Cancel: function() {
                    dialog.dialog("close");
                }
            },
            close: function() {
                form[0].reset();
                allFields.removeClass("ui-state-error");
            }
        });

        function submitted() {
            renameNode();
            dialog.dialog("close");
        }

        var form = dialog.find("form").on("submit", function(event) {
            event.preventDefault();
            submitted();
        });

        $("#rename-node-button").button().on("click", function() {
            dialog.dialog("open");
        });
    });

    // create the filterlist dialog
    $(function() {
        $("#filter-list").selectable({
            selecting: function(event, ui) {
                if (event.detail == 0) {
                    _selectRange = true;
                    return true;
                }
                if ($(ui.selecting).hasClass('ui-selected')) {
                    _deselectQueue.push(ui.selecting);
                }
            },
            unselecting: function(event, ui) {
                $(ui.unselecting).addClass('ui-selected');
            },
            stop: function() {
                if (!_selectRange) {
                    $.each(_deselectQueue, function(ix, de) {
                        $(de)
                            .removeClass('ui-selecting')
                            .removeClass('ui-selected');
                    });
                }
                _selectRange = false;
                _deselectQueue = [];

                // enable or disable the remove filters button depending
                // on whether any elements have been selected
                var selected = [];
                $(".ui-selected", this).each(function() {
                    selected.push(index);
                    var index = $("#filter-list li").index(this);
                });
                if (selected.length > 0) {
                    $(".ui-dialog-buttonpane button:contains('Remove Filters')").button("enable");
                } else {
                    $(".ui-dialog-buttonpane button:contains('Remove Filters')").button("disable");
                }
            }
        });
    });

    $(function() {
        var dialog;
        var selected;

        dialog = $("#filter-list-dialog").dialog({
            autoOpen: false,
            autoResize: true,
            resizable: true,
            modal: false,
            minWidth: 360,
            position: {
                my: "right top",
                at: "right top",
                of: "#mynetwork"
            },
            buttons: {
                "Remove Filters": function() {
                    $("#filter-list .ui-selected", this).each(function() {
                        // The inner text contains the name of the filter
                        //alertWithObject("[XX] selected:", this);
                        var address;
                        if (this.innerText) {
                            sendCommand("remove_filter", this.innerText);
                        } else if (this.innerHTML) {
                            sendCommand("remove_filter", this.innerHTML);
                        }
                        $(".ui-dialog-buttonpane button:contains('Remove Filters')").button("disable");
                    });
                },
                Reset: function() {
                    sendCommand("reset_filters", "");
                },
                Close: function() {
                    dialog.dialog("close");
                }
            },
            close: function() {}
        });

        $(".ui-dialog-buttonpane button:contains('Remove Filters')").button("disable");
        $("#filter-list-button").button().on("click", function() {
            dialog.dialog("open");
        });
    });

    showGraph(traffic_dataset);
    showNetwork();
    initTrafficDataView();

    // clean up every X seconds
    setInterval(cleanNetwork, 5000);
}

//
// Traffic-graph code
//
function showGraph(dataset) {
    var container = document.getElementById('visualization');

    //
    // Group options
    //
    var names = ['Traffic size', 'Packet count'];
    var groups = new vis.DataSet();
    groups.add({
        id: 0,
        content: names[0],
        options: {
            shaded: {
                orientation: 'bottom' // top, bottom
            }
        }
    });

    groups.add({
        id: 1,
        content: names[1],
        options: {
            shaded: {
                orientation: 'bottom' // top, bottom
            },
            yAxisOrientation: 'right'
        }
    });

    // Graph options
    var options = {
        //start: '2017-01-26',
        //end: '2017-01-28',
        height: '140px',
        drawPoints: false,
        //clickToUse: true
    };

    graph2d_1 = new vis.Graph2d(container, dataset, groups, options);
}

//
// Network-view code
//

var shadowState, nodesArray, nodes, edgesArray, edges, network, curNodeId, curEdgeId;

function showNetwork() {
    // mapping from ip to nodeId
    shadowState = true;

    // start counting with one (is this internally handled?)
    curNodeId = 1;
    curEdgeId = 1;

    // create an array with nodes
    nodesArray = [];
    nodes = new vis.DataSet(nodesArray);

    // create an array with edges
    edgesArray = [];
    edges = new vis.DataSet(edgesArray);

    // create a network
    var container = document.getElementById('mynetwork');
    var data = {
        nodes: nodes,
        edges: edges
    };
    var options = {
        autoResize: true,
        //clickToUse: true,
        physics: {
            //solver: 'repulsion',
            enabled:true,
            barnesHut: {
/*
                gravitationalConstant: -2000,
                centralGravity: 0.3,
                springLength: 95,
                springConstant: 0.04,
                damping: 0.09,
                avoidOverlap: 0.5
*/
            },
            stabilization: {
                enabled: true,
                iterations: 5,
            }
        },
        nodes: {
            shadow:shadowState
        },
        edges: {
            shadow:shadowState,
            arrows:'to',smooth:true
        }
    };
    network = new vis.Network(container, data, options);
    network.on("selectNode", nodeSelected);
    network.on("dragStart", nodeSelected);
    network.on("zoom", enableZoomLock);
}

function updateNodeInfo(nodeId) {
    var node = nodes.get(nodeId);
    writeToScreen("trafficcount", "Connections seen: " + node.count);
    writeToScreen("trafficsize", "Traffic size: " + node.size);
    writeToScreen("ipaddress", "");
    writeToScreen("lastseen", "Last seen: " + new Date(node.lastseen * 1000));
    // TODO: mark that this is hw not ip

    return node;
}

function nodeSelected(event) {
    var nodeId = event.nodes[0];
    if (typeof(nodeId) == 'number' && selectedNodeId != nodeId) {
        var node = updateNodeInfo(nodeId);
        selectedNodeId = nodeId;
        writeToScreen("nodeid", "Node: " + nodeId);
        //sendCommand("arp2ip", node.address); // talk to Websocket
        if ("ips" in node) {
            writeToScreen("ipaddress", "IP: " + node.ips.join());
        } else {
            writeToScreen("ipaddress", "IP: ");
        }
        if ("domains" in node) {
            writeToScreen("reversedns", "DNS: " + node.domains.join());
        } else {
            writeToScreen("reversedns", "DNS: ");
        }


        //sendCommand("ip2hostname", node.address);
        //writeToScreen("netowner", "Network owner: &lt;searching&gt;");
        //sendCommand("ip2netowner", node.address); // talk to Websocket
        $("#nodeinfo").dialog('option', 'title', node.label);
        $("#nodeinfo").dialog('open');

        $("#firewall-node-button").button().on("click", function () {
            var node = nodes.get(selectedNodeId);
            // hmm. misschien we should actually remove the node and
            // let the next occurrence take care of presentation?
            if (node.blocked) {
                sendCommand("stopblockdata", selectedNodeId);
                node.blocked = false;
            } else {
                sendCommand("blockdata", selectedNodeId);
                node.blocked = true;
            }
            nodes.update(node);
            updateBlockedButton();
        })
        updateBlockedButton();

    }
}

function updateBlockedButton() {
    var node = nodes.get(selectedNodeId);
    var label = node.blocked ? "Unblock node" : "Block node";
    $("#firewall-node-button").button("option", {
        "label": label
    });
}

/* needed?
    function resetAllNodes() {
        nodes.clear();
        edges.clear();
        nodes.add(nodesArray);
        edges.add(edgesArray);
    }

    function resetAllNodesStabilize() {
        resetAllNodes();
        network.stabilize();
    }

    function resetAll() {
        if (network !== null) {
            network.destroy();
            network = null;
        }
        showNetwork();
    }

    function setTheData() {
        nodes = new vis.DataSet(nodesArray);
        edges = new vis.DataSet(edgesArray);
        network.setData({nodes:nodes, edges:edges})
    }

    function haveNode(ip) {
        return (ip in nodeIds);
    }

    function alertWithObject(m, o) {
        str = m + "\n";
        for(var propertyName in o) {
           // propertyName is what you want
           // you can get the value like this: myObject[propertyName]
           str += propertyName + ": " + o[propertyName] + "\n";
        }
        alert(str);
    }

*/

function updateNode(node) {
    if (!node) { return; }
    var enode = nodes.get(node.id);
    if (!enode) { return; }

    var label = node.id;
    // should only change color if it was recent and is no longer so
    // but that is for a separate loop (unless it's internal device
    // and we just discovered that, in which case we set it to _src)
    //var colour = node.blocked ? colour_blocked : colour_recent;
    var ips = node.ips ? node.ips : [];
    var domains = node.domains ? node.domains : [];
    if (node.name) {
        label = node.name;
    } else if (node.mac) {
        label = node.mac;
    } else if (domains.length > 0) {
        label = node.domains[0];
    } else if (ips.length > 0) {
        label = node.ips[0];
    }

    if (node.mac) {
        node.color = colour_src;
    } else {
        node.color = colour_recent;
    }

    enode.label = label;
    enode.ips = ips;
    enode.domains = domains;

    nodes.update(enode);

    if (node.id == selectedNodeId) {
        updateNodeInfo(node.id);
    }
}

// Used in AddFlow()
function addNode(timestamp, node, scale, count, size, lwith, type) {
    // why does this happen
    if (!node) { return; }
    // find the 'best' info we can display in the main view
    var label = "<working>";
    var colour = colour_recent;
    var ips = node.ips ? node.ips : [];
    var domains = node.domains ? node.domains : [];
    var blocked = type == "blocked";
    if (node.name) {
        label = node.name;
    } else if (node.mac) {
        label = node.mac;
    } else if (domains.length > 0) {
        label = node.domains[0];
    } else if (ips.length > 0) {
        label = node.ips[0];
    }

    if (node.mac) {
        colour = colour_src;
    } else {
        if (blocked) {
            colour = colour_blocked;
        } else {
            colour = colour_recent;
        }
    }

    //alert("add node: " + node)
    var enode = nodes.get(node.id);
    if (enode) {
        // update is
        enode.label = label;
        enode.ips = ips;
        enode.domains = domains;
        enode.color = colour;
        enode.blocked = blocked;
        enode.lastseen = timestamp;
        nodes.update(enode);
    } else {
        // it's new
        nodes.add({
            id: node.id,
            addresses: node.ips ? node.ips : [],
            domains: node.domains ? node.domains : [],
            label: label,
            color: colour,
            value: size,
            count: count,
            size: size,
            lastseen: timestamp,
            blocked: blocked,
            scaling: {
                min: 1,
                label: {
                    enabled: true
                }
            }
        });
    }
}

// Used in AddFlow()
function addEdge(from, to, colour) {
    var existing = edges.get({
        filter: function(item) {
            return (item.from == from.id && item.to == to.id);
        }
    });
    if (existing.length == 0) {
        edges.add({
            id: curEdgeId,
            from: from.id,
            to: to.id,
            color: colour
        });
        curEdgeId += 1;
    }
}

// Delete the given node (note: not nodeId) and all nodes
// that are connected only to this node
function deleteNodeAndConnectedNodes(node) {
    // find all nodes to delete; that is this node and all nodes
    // connected to it that have no other connections
    network.stopSimulation();
    var connectedNodes = getConnectedNodes(node.id);
    var toDelete = [];
    for (var i=0; i < connectedNodes.length; i++) {
        var otherNodeId = connectedNodes[i];
        var otherConnections = getConnectedNodes(otherNodeId);
        if (otherConnections.length == 1) {
            deleteNode(nodes.get(otherNodeId), false);
        }
    }
    deleteNode(node, true);
    network.startSimulation();
}

// Remove a node from the screen
// If deleteEdges is true, also remove all edges connected to this node
function deleteNode(node, deleteNodeEdges) {
    if (deleteNodeEdges) {
        deleteEdges(node.id);
    }
    nodes.remove(node.id);
}

// Returns a list of all nodeIds that have an edge to the given nodeId
function getConnectedNodes(nodeId) {
    var result = [];
    var cedges = edges.get({
        filter: function(item) {
            return (item.from == nodeId);
        }
    });
    for (var i=0; i < cedges.length; i++) {
        var edge = cedges[i];
        result.push(edge.to);
    }
    cedges = edges.get({
        filter: function(item) {
            return (item.to == nodeId);
        }
    });
    for (var i=0; i < cedges.length; i++) {
        var edge = cedges[i];
        result.push(edge.from);
    }
    return result;
}


// Used in spinsocket.js
function deleteEdges(nodeId) {
    var toDelete = edges.get({
        filter: function(item) {
            return (item.from == nodeId || item.to == nodeId);
        }
    });
    for (var i = 0; i < toDelete.length; i++) {
        var edge = toDelete[i];
        var e = edges.get(edge);
        edges.remove(edge.id);
    }
}

function contains(l, e) {
    for (var i=l.length; i>=0; i--) {
        if (l[i] == e) {
            return true;
        }
    }
    return false;
}

// Used in spinsocket.js
function addFlow(timestamp, from, to, count, size) {
    // there may be some residual additions from a recently added
    // filter, so ignore those

    // TODO ignore for now, data structure of from and to changed
    //if (contains(filterList, from) || contains(filterList, to)) {
    //    return;
    //}
    addNode(timestamp, from, false, count, size, "to " + to, "source");
    addNode(timestamp, to, true, count, size, "from " + from, "traffic");
    addEdge(from, to, colour_edge);
    if (!zoom_locked) {
        network.fit({
            duration: 0
        });
    }
}

function addBlocked(timestamp, from, to) {
    if (contains(filterList, from) || contains(filterList, to)) {
        return;
    }
    addNode(timestamp, from, false, 1, 1, "to " + to, "source");
    addNode(timestamp, to, false, 1, 1, "from " + from, "blocked");
    addEdge(from, to, colour_blocked);
    if (!zoom_locked) {
        network.fit({
            duration: 0
        });
    }
}

function cleanNetwork() {
    var now = Math.floor(Date.now() / 1000);
    var delete_before = now - 600;
    var unhighlight_before = now - 30;

    var ids = nodes.getIds();
    for (var i = 0; i < ids.length; i++) {
        var node = nodes.get(ids[i]);
        if (node.lastseen < delete_before) {
            deleteNode(node, true);
        } else if (node.lastseen < unhighlight_before && node["color"] == colour_recent) {
            node["color"] = colour_dst;
            nodes.update(node);
        }
    }
}
