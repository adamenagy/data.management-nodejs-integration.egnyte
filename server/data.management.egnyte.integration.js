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

'use strict'; // http://www.w3schools.com/js/js_strict.asp

// token handling in session
var token = require('./token');

// web framework
var express = require('express');
var router = express.Router();
var bodyParser = require('body-parser');
var jsonParser = bodyParser.json();

// config information, such as client ID and secret
var config = require('./config');

// forge 
var forgeDM = require('forge-data-management');
var forgeOSS = require('forge-oss');

var request = require('request');

var egnyteSDK = require('egnyte-js-sdk');

router.post('/integration/sendToEgnyte', jsonParser, function (req, res) {
    var tokenSession = new token(req.session);
    if (!tokenSession.isAuthorized()) {
        res.status(401).json({error: 'Please login first'});
        return;
    }
    // Configure OAuth2 access token for authorization: oauth2_access_code
    var defaultClient = forgeDM.ApiClient.instance;
    var oauth = defaultClient.authentications ['oauth2_access_code'];
    oauth.accessToken = tokenSession.getTokenInternal();

    // file IDs to transfer
    var autodeskFileId = decodeURIComponent(req.body.autodeskfile);
    var egnyteFolderId = req.body.egnytefolder;

    // the autodesk file id parameters should be in the form of
    // /data/v1/projects/::project_id::/versions/::version_id::
    var params = autodeskFileId.split('/');
    var projectId = params[params.length - 3];
    var versionId = params[params.length - 1];

    var versions = new forgeDM.VersionsApi();
    versions.getVersion(projectId, versionId).then(function (version) {
        if (!version.data.relationships.storage || !version.data.relationships.storage.meta.link.href) {
            res.status(500).json({error: 'No storage defined, cannot transfer.'});
            return;
        }
        var storageLocation = version.data.relationships.storage.meta.link.href;
        // the storage location should be in the form of
        // /oss/v2/buckets/::bucketKey::/objects/::objectName::
        params = storageLocation.split('/');
        var bucketKey = params[params.length - 3];
        var objectName = params[params.length - 1];

        var defaultOSSClient = forgeOSS.ApiClient.instance;
        var oauthOSS = defaultOSSClient.authentications ['oauth2_application']; // not the 'oauth2_access_code', as per documentation
        oauthOSS.accessToken = tokenSession.getTokenInternal();
        var objects = new forgeOSS.ObjectsApi();

        // npm forge-oss call to download not working
        //objects.getObject(bucketKey, objectName).then(function (file) {

        // workaround to download
        request({
            url: storageLocation,
            method: "GET",
            headers: {
                'Authorization': 'Bearer ' + tokenSession.getTokenInternal(),
            },
            encoding: null
        }, function (error, response, file) {
            if (error) {
                console.log(error);
                res.status(error.statusCode).end(error.statusMessage);
                return;
            }
            // end of workaround

            var egnyte = egnyteSDK.init("https://autodesktesting.egnyte.com", {
                token: tokenSession.getEgnyteToken()
            });

            var fileName = version.data.attributes.name;

            /*
            var pathInfo = egnyte.API.storage.path(egnyteFolderId + "/" + fileName);
            pathInfo.storeFile(file)
                .then(function (data) {
                    res.json({ result: "OK", file: fileName });
                })
                .catch(function (error) {
                    res.status(error.statusCode).end(error.statusMessage);
                });
            */
            request({
                url:  'https://autodesktesting.egnyte.com/pubapi/v1/fs-content/' + egnyteFolderId + "/" + fileName,
                method: "POST",
                headers: {
                    'Authorization': 'Bearer ' + tokenSession.getEgnyteToken(),
                },
                encoding: null,
                body: file
            }, function (error, response, file) {
                if (error) {
                    console.log(error);
                    res.status(error.statusCode).end(error.statusMessage);
                    return;
                }

                res.json({ result: "OK", file: fileName });
            });


        });

        //.catch(function (e) { res.status(e.error.statusCode).json({error: e.error.body}) });
    }).catch(function (e) {
        res.status(e.error.statusCode).json({error: e.error.body})
    });
});

router.post('/integration/sendToAutodesk', jsonParser, function (req, res) {
    var tokenSession = new token(req.session);
    if (!tokenSession.isAuthorized()) {
        res.status(401).json({error: 'Please login first'});
        return;
    }
    // Configure OAuth2 access token for authorization: oauth2_access_code
    var defaultClient = forgeDM.ApiClient.instance;
    defaultClient.authentications ['oauth2_access_code'].accessToken = tokenSession.getTokenInternal();
    defaultClient.authentications ['oauth2_application'].accessToken = tokenSession.getTokenInternal();

    var defaultClient = forgeOSS.ApiClient.instance;
    defaultClient.authentications ['oauth2_access_code'].accessToken = tokenSession.getTokenInternal();
    defaultClient.authentications ['oauth2_application'].accessToken = tokenSession.getTokenInternal();

    var projects = new forgeDM.ProjectsApi();

    // file IDs to transfer
    var autodeskType = req.body.autodesktype; // projects or folders
    var autodeskId = decodeURIComponent(req.body.autodeskid);
    var egnyteFileId = req.body.egnytefile;

    var projectId;
    var folderId;
    var params = autodeskId.split('/');
    switch (autodeskType) {
        case "folders":
            projectId = params[params.length - 3];
            folderId = params[params.length - 1];
            sendToAutodesk(projectId, folderId, egnyteFileId, res, req);
            break;
        case "projects":
            projectId = params[params.length - 1];
            var hubId = params[params.length - 3];
            projects.getProject(hubId, projectId).then(function (project) {
                folderId = project.data.relationships.rootFolder.data.id;
                sendToAutodesk(projectId, folderId, egnyteFileId, res, req);
            });
            break;
    }
});

function uploadFile(projectId, folderId, fileName, fileSize, fileData) {
    return new Promise(function (_resolve, _reject) {
        // Ask for storage for the new file we want to upload
        var projects = new forgeDM.ProjectsApi();
        projects.postStorage(projectId, JSON.stringify(storageSpecData(fileName, folderId)))
            .then(function (storageData) {
                var objectId = storageData.data.id;
                var bucketKeyObjectName = getBucketKeyObjectName(objectId);


                // Upload the new file
                var objects = new forgeOSS.ObjectsApi();
                objects.uploadObject(bucketKeyObjectName.bucketKey, bucketKeyObjectName.objectName, fileSize, fileData)
                    .then(function (objectData) {
                        console.log('uploadObject: succeeded');
                        _resolve(objectData.objectId);
                    })
                    .catch(function (error) {
                        console.log('uploadObject: failed');
                        _reject(error);
                    });

            })
            .catch(function (error) {
                _reject(error);
            });
    });
}

function withoutExtension(fileName) {
    // Remove the last ".<extension>"
    // e.g.:
    // my.file.jpg >> my.file
    // myfile >> myfile
    return fileName.replace(/(.*)\.(.*?)$/, "$1");
}

function createNewItemOrVersion(projectId, folderId, fileName, objectId) {
    return new Promise(function (_resolve, _reject) {

        var folders = new forgeDM.FoldersApi();

        folders.getFolderContents(projectId, folderId)
            .then(function (folderData) {
                var item = null;
                for (var key in folderData.data) {
                    item = folderData.data[key];
                    // Sometimes the item's displayName does not include the extension
                    // but its version will!!
                    if (item.attributes.displayName === fileName || item.attributes.displayName === withoutExtension(fileName)) {
                        break;
                    } else {
                        item = null;
                    }
                }

                var projects = new forgeDM.ProjectsApi();

                if (item) {
                    // We found it so we should create a new version

                    projects.postVersion(projectId, JSON.stringify(versionSpecData(fileName, projectId, item.id, objectId)))
                        .then(function (versionData) {
                            _resolve(versionData.data.id);
                        })
                        .catch(function (error) {
                            console.log('postVersion: failed');

                            _reject(error);
                        });
                } else {
                    // We did not find it so we should create it

                    projects.postItem(projectId, JSON.stringify(itemSpecData(fileName, projectId, folderId, objectId)))
                        .then(function (itemData) {
                            // Get the versionId out of the reply
                            _resolve(itemData.included[0].id);
                        })
                        .catch(function (error) {
                            console.log('postItem: failed');

                            _reject(error);
                        });
                }
            })
            .catch(function (error) {
                console.log('getFolderContents: failed');
                _reject(error);
            });
    });
}

function sendToAutodesk(projectId, folderId, egnyteFileId, res, req) {
    var tokenSession = new token(req.session);

    /*
     var egnyte = egnyteSDK.init("https://autodesktesting.egnyte.com", {
     token: tokenSession.getEgnyteToken()
     });


     var pathInfo = egnyte.API.storage.path(egnyteFileId);
     pathInfo.download(null, true)
     .then(function (file) {
     var str = "";
     })
     .catch(function (error) {
     var str = "";
     });
     */

    var paths = egnyteFileId.split('/');
    var fileName = paths[paths.length - 1];

    request({
        url: "https://autodesktesting.egnyte.com/pubapi/v1/fs-content/" + egnyteFileId,
        encoding: null,
        method: "GET",
        headers: {'Authorization': 'Bearer ' + tokenSession.getEgnyteToken()}
    }, function (error, response, body) {
        if (error != null) {
            console.log(error); // connection problems

            if (body.errors != null)
                console.log(body.errors);

            res.status(error.statusCode).end(error.statusMessage);

            return;
        }

        uploadFile(projectId, folderId, fileName, body.length, body)
            .then(function (objectId) {
                createNewItemOrVersion(projectId, folderId, fileName, objectId)
                    .then(function (versionId) {
                        var str = "";
                        res.json({result: "OK", file: fileName});
                    })
                    .catch(function (error) {
                        var str = "";
                        res.status(error.statusCode).end(error.statusMessage);
                    });
            })
            .catch(function (error) {
                res.status(error.statusCode).end(error.statusMessage);
            });
    });
}

function getBucketKeyObjectName(objectId) {
    // the objectId comes in the form of
    // urn:adsk.objects:os.object:BUCKET_KEY/OBJECT_NAME
    var objectIdParams = objectId.split('/');
    var objectNameValue = objectIdParams[objectIdParams.length - 1];
    // then split again by :
    var bucketKeyParams = objectIdParams[objectIdParams.length - 2].split(':');
    // and get the BucketKey
    var bucketKeyValue = bucketKeyParams[bucketKeyParams.length - 1];

    var ret = {
        bucketKey: bucketKeyValue,
        objectName: objectNameValue
    };
    return ret;
}

function storageSpecData(fileName, folderId) {
    var storageSpecs = {
        data: {
            type: 'objects',
            attributes: {
                name: fileName
            },
            relationships: {
                target: {
                    data: {
                        type: 'folders',
                        id: folderId
                    }
                }
            }
        }
    };
    return storageSpecs;
}

function itemSpecData(fileName, projectId, folderId, objectId) {
    var itemsType = projectId.startsWith("a.") ? "items:autodesk.core:File" : "items:autodesk.bim360:File";
    var versionsType = projectId.startsWith("a.") ? "versions:autodesk.core:File" : "versions:autodesk.bim360:File";
    var itemSpec = {
        jsonapi: {
            version: "1.0"
        },
        data: {
            type: "items",
            attributes: {
                displayName: fileName,
                extension: {
                    type: itemsType,
                    version: "1.0"
                }
            },
            relationships: {
                tip: {
                    data: {
                        type: "versions",
                        id: "1"
                    }
                },
                parent: {
                    data: {
                        type: "folders",
                        id: folderId
                    }
                }
            }
        },
        included: [{
            type: "versions",
            id: "1",
            attributes: {
                name: fileName,
                extension: {
                    type: versionsType,
                    version: "1.0"
                }
            },
            relationships: {
                storage: {
                    data: {
                        type: "objects",
                        id: objectId
                    }
                }
            }
        }]
    };

    if (fileName.endsWith(".iam.zip")) {
        itemSpec.data[0].attributes.extension.type = "versions:autodesk.a360:CompositeDesign";
        itemSpec.data[0].attributes.name = fileName.slice(0, -4);
        itemSpec.included[0].attributes.name = fileName.slice(0, -4);
    }

    console.log(itemSpec);

    return itemSpec;
}

function versionSpecData(fileName, projectId, itemId, objectId) {
    var versionsType = projectId.startsWith("a.") ? "versions:autodesk.core:File" : "versions:autodesk.bim360:File";

    var versionSpec = {
        "jsonapi": {
            "version": "1.0"
        },
        "data": {
            "type": "versions",
            "attributes": {
                "name": fileName,
                "extension": {
                    "type": versionsType,
                    "version": "1.0"
                }
            },
            "relationships": {
                "item": {
                    "data": {
                        "type": "items",
                        "id": itemId
                    }
                },
                "storage": {
                    "data": {
                        "type": "objects",
                        "id": objectId
                    }
                }
            }
        }
    }

    if (fileName.endsWith(".iam.zip")) {
        versionSpec.data.attributes.extension.type = "versions:autodesk.a360:CompositeDesign";
        versionSpec.data.attributes.name = fileName.slice(0, -4);
    }

    console.log(versionSpec);

    return versionSpec;
}

function getMineType(fileName) {
    var re = /(?:\.([^.]+))?$/; // regex to extract file extension
    var extension = re.exec(fileName)[1];
    var types = {
        'png': 'application/image',
        'jpg': 'application/image',
        'txt': 'application/txt',
        'ipt': 'application/vnd.autodesk.inventor.part',
        'iam': 'application/vnd.autodesk.inventor.assembly',
        'dwf': 'application/vnd.autodesk.autocad.dwf',
        'dwg': 'application/vnd.autodesk.autocad.dwg',
        'f3d': 'application/vnd.autodesk.fusion360',
        'f2d': 'application/vnd.autodesk.fusiondoc',
        'rvt': 'application/vnd.autodesk.revit'
    };

    return (types[extension] != null ? types[extension] : 'application/' + extension);
}

module.exports = router;