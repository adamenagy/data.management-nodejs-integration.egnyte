/////////////////////////////////////////////////////////////////////
// Copyright (c) Autodesk, Inc. All rights reserved
// Written by Forge Partner Development
//
// Permission to use, copy, modify, and distribute this software in
// object code form for any purpose and without fee is hereby granted,
// provided that the above copyright notice appears in all copies and
// that both that copyright notice and the limited warranty and
// restricted rights notice below appear in all supporting
// documentation.
//
// AUTODESK PROVIDES THIS PROGRAM "AS IS" AND WITH ALL FAULTS.
// AUTODESK SPECIFICALLY DISCLAIMS ANY IMPLIED WARRANTY OF
// MERCHANTABILITY OR FITNESS FOR A PARTICULAR USE.  AUTODESK, INC.
// DOES NOT WARRANT THAT THE OPERATION OF THE PROGRAM WILL BE
// UNINTERRUPTED OR ERROR FREE.
/////////////////////////////////////////////////////////////////////

$(document).ready(function () {
    isEgnyteAuthorized(function (isAuthorized) {
        if (!isAuthorized) {
            $('#refreshEgnyteTree').hide();
            $('#loginEgnyte').click(egnyteLogin);
        } else {
            getEgnyteUserProfile(function (profile) {
                $('#loginEgnyteText').text(profile.name);
            });

            $('#refreshEgnyteTree').show();
            $('#refreshEgnyteTree').click(function () {
                $('#myEgnyteFiles').jstree(true).refresh();
            });
            prepareEgnyteTree();
        }
    })
});

function egnyteLogin() {
    jQuery.ajax({
        url: '/egnyte/authenticate',
        success: function (rootUrl) {
            location.href = rootUrl;
        }
    });
}

function isEgnyteAuthorized(callback) {
    var ret = 'false';
    jQuery.ajax({
        url: '/egnyte/isAuthorized',
        success: function (res) {
            callback(res === 'true');
        },
        error: function (err) {
            callback(false);
        }
    });
}

function prepareEgnyteTree() {
    $('#myEgnyteFiles').jstree({
        'core': {
            'themes': {"icons": true},
            'data': {
                "url": '/egnyte/getTreeNode',
                "dataType": "json",
                'multiple': false,
                "data": function (node) {
                    return {"id": node.id};
                }
            }
        },
        'types': {
            'default': {
                'icon': 'glyphicon glyphicon-cloud'
            },
            'file': {
                'icon': 'glyphicon glyphicon-file'
            },
            'folder': {
                'icon': 'glyphicon glyphicon-folder-open'
            }
        },
        "plugins": ["types", "state", "sort", "contextmenu"],
        contextmenu: {items: egnyteCustomMenu}
    });
}

function egnyteCustomMenu(node) {
    var items;

    if (node.type == 'file') {
        items = {
            renameItem: {
                label: "Send to Autodesk",
                icon: "/img/autodesk-forge.png",
                action: function () {
                    var autodeskNode = $('#myAutodeskFiles').jstree(true).get_selected(true)[0];
                    sendToAutodesk(node, autodeskNode);
                }
            }
        };
    }

    return items;
}

var re = /(?:\.([^.]+))?$/; // regex to extract file extension

function sendToAutodesk(egnyteNode, autodeskNode) {
    if (autodeskNode == null || (autodeskNode.type != 'projects' && autodeskNode.type != 'folders')) {
        $.notify('Please select a Project or Folder on Autodesk Hubs', 'error');
        return;
    }

    isFileSupported(re.exec(egnyteNode.text)[1], function (supported) {
        if (!supported) {
            $.notify('File "' + egnyteNode.text + '" cannot be translated to Forge Viewer', 'warn');
        }

        $.notify(
            'Preparing to send file "' + egnyteNode.text + '" to "' + autodeskNode.text + '" Autodesk ' +
            autodeskNode.type, 'info'
        );

        jQuery.ajax({
            url: '/integration/sendToAutodesk',
            contentType: 'application/json',
            type: 'POST',
            dataType: 'json',
            data: JSON.stringify({
                'autodesktype': autodeskNode.type, // projects or folders
                'autodeskid': autodeskNode.id,
                'egnytefile': egnyteNode.id
            }),
            success: function (res) {
                $.notify('Transfer of file "' + res.file + '" completed', 'info');
                $('#myAutodeskFiles').jstree(true).refresh_node(autodeskNode);
            },
            error: function (res) {
                $.notify(res.responseText, 'error');
            }
        });
    });
}

function isFileSupported(extension, callback) {
    jQuery.ajax({
        url: '/md/formats',
        contentType: 'application/json',
        type: 'GET',
        dataType: 'json',
        success: function (supportedFormats) {
            callback(( jQuery.inArray(extension, supportedFormats) >= 0));
        }
    });
}

function getEgnyteUserProfile(onsuccess) {
    var profile = '';
    jQuery.ajax({
        url: '/egnyte/profile',
        success: function (profile) {
            onsuccess(JSON.parse(profile));
        }
    });
}