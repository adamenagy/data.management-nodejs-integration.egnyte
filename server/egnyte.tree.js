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

// config information, such as client ID and secret
var config = require('./config');

// box sdk: https://github.com/box/box-node-sdk/
var BoxSDK = require('box-node-sdk');

var egnyteSDK = require('egnyte-js-sdk');
var request = require('request');

router.get('/egnyte/authenticate', function (req, res) {
  /*
  var url =
    'https://account.box.com/api/oauth2/authorize?response_type=code&' +
    '&client_id=' + config.egnyte.credentials.client_id +
    '&redirect_uri=' + config.egnyte.callbackURL +
    '&state=autodeskforge';
*/

  // sample request:
  // https://apidemo.egnyte.com/puboauth/token?client_id=x2g35g8gynb5cedas649m4h4
  // &client_secret=SECRET_KEY&redirect_uri=https://yourapp.com/oauth
  // &scope=Egnyte.filesystem&state=apidemo123&response_type=code

  var url =
      'https://autodesktesting.egnyte.com/puboauth/token?' +
      'client_id=' + config.egnyte.credentials.client_id +
      '&client_secret=' + config.egnyte.credentials.client_secret +
      '&redirect_uri=' + config.egnyte.callbackURL +
      '&scope=Egnyte.filesystem' +
      '&state=uptomewhatIpasshere' +
      '&response_type=code'
  res.end(url);
});

// wait for box callback (oAuth callback)
router.get('/api/egnyte/callback/oauth', function (req, res) {
  var code = req.query.code;
  var tokenSession = new token(req.session);

  request({
    url: "https://autodesktesting.egnyte.com/puboauth/token",
    method: "POST",
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body:
      'client_id=' + config.egnyte.credentials.client_id +
      '&client_secret=' + config.egnyte.credentials.client_secret +
      '&redirect_uri=' + config.egnyte.callbackURL +
      '&code=' + code +
      '&grant_type=authorization_code'
  }, function (error, response, body) {
    if (error != null) {
      console.log(error); // connection problems

      if (body.errors != null)
        console.log(body.errors);

      res.status(error.statusCode).end(error.statusMessage);

      return;
    }

    var json = JSON.parse(body);
    tokenSession.setEgnyteToken(json.access_token);

    res.redirect('/');
  })
});

// return the public token of the current user
// the public token should have a limited scope (read-only)
router.get('/egnyte/isAuthorized', function (req, res) {
  var tokenSession = new token(req.session);
  res.end(tokenSession.isEgnyteAuthorized() ? 'true' : 'false');
});

router.get('/egnyte/getTreeNode', function (req, res) {
  var tokenSession = new token(req.session);
  if (!tokenSession.isEgnyteAuthorized()) {
    res.status(401).end('Please box login first');
    return;
  }

  var egnyte = egnyteSDK.init("https://autodesktesting.egnyte.com", {
    token: tokenSession.getEgnyteToken()
  });

  try {
      var path = req.query.id === '#' ? '/' : req.query.id;
      var root = egnyte.API.storage.path(path);
      root.get()
          .then(function (data) {
              var result = prepareArraysForJSTree(data.folders, data.files);
              res.end(result);
          })
          .catch(function (error) {
              res.status(error.statusCode).end(error.statusMessage);
          });
  } catch (err) {
      res.status(500).end(err.message);
  }
  /*
  var box = sdk.getBasicClient(tokenSession.getBoxToken());

  var id = (req.query.id === '#' ? '0' : req.query.id);
  box.folders.getItems(id, {fields: 'name,shared_link,permissions,collections,sync_state'}, function (err, data) {
    res.end(prepareArrayForJSTree(data.entries));
  });*/
});

// Formats a list to JSTree structure
function prepareArraysForJSTree(folders, files) {
  var treeList = [];

  if (folders) {
    folders.forEach(function (item, index) {
      //console.log(item);
      var treeItem = {
        id: item.path,
        text: item.name,
        type: item.is_folder ? 'folder' : 'file',
        children: item.is_folder
      };
      treeList.push(treeItem);
    });
  }

  if (files) {
    files.forEach(function (item, index) {
      //console.log(item);
      var treeItem = {
        id: item.path,
        text: item.name,
        type: item.is_folder ? 'folder' : 'file',
        children: item.is_folder
      };
      treeList.push(treeItem);
    });
  }

  return JSON.stringify(treeList);
}

module.exports = router;
