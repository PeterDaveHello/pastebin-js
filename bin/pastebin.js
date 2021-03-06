'use strict';
/*
 * pastebin-js
 * https://github.com/j3lte/pastebin-js
 *
 * Copyright (c) 2014 Jelte Lagendijk
 * Licensed under the MIT license.
 */

var _ = require('underscore');
var fs = require('fs');
var xml2js = require('xml2js');
var Q = require('q');
var method = require('../lib/methods');
var conf = require('../lib/config');

/**
 * Pastebin constructor
 */
function Pastebin(config) {
    if (typeof config === 'string') {
        config = { api_dev_key : config };
    }
    this.config = _.extend(conf.defaults, config);
}

/**
 * Get a paste
 * @param  {String}   id    Id of the paste
 * @return {Object}         Promise
 */
Pastebin.prototype.getPaste = function (id) {
    if (!id) {
        var deferred = Q.defer();
        deferred.reject(new Error('[-] getPaste : No paste id given!'));
        return deferred.promise;
    }
    return method.get(conf.net.protocol + conf.net.base + conf.net.endpoint.raw + id, null);
};

/**
 * Create a paste
 * @param  {String}   text       Text to be pasted
 * @param  {String}   title      Title of the paste (optional)
 * @param  {String}   format     Format of the paste, for syntax highlighting. See /lib/config.js (optional)
 * @param  {Number}   privacy    Privacylevel of the paste (0 = public, 1 = unlisted and 2 = private) (optional, default = 0)
 * @param  {String}   expiration Expiration time of the paste See /lib/config.js
 * @return {Object}   Promise
 */
Pastebin.prototype.createPaste = function (text, title, format, privacy, expiration) {
    var deferred = Q.defer();
    var p = {
        api_option : 'paste',
        api_dev_key : this.config.api_dev_key,
        api_paste_code : text,
    };
    var noKeyNeeded = true;

    if (typeof text !== 'string') {
        deferred.reject(new Error('Error! Paste can only be a text!'));
        return deferred.promise;
    }

    if (typeof title !== 'undefined' && title !== null) {
        p.api_paste_name = title;
    }

    if (typeof format !== 'undefined' && format !== null) {
        if (conf.formats[format]) {
            p.api_paste_format = format;
        } else {
            deferred.reject(new Error('Error! Paste format ' + format + ' is unknown.'));
            return deferred.promise;
        }
    }

    if (typeof privacy !== 'undefined' && privacy !== null) {
        if (privacy === 0 || privacy === 1) {
            p.api_paste_private = privacy;
        } else if (privacy === 2) {
            if (this.config.api_user_key) {
                p.api_user_key = this.config.api_user_key;
            } else if (this.config.api_user_name !== null && this.config.api_user_password !== null) {
                noKeyNeeded = false;
                this.createAPIuserKey()
                    .then(function () {
                        this.createPaste(text, title, format, privacy, expiration)
                            .then(deferred.resolve)
                            .fail(deferred.reject);
                        return deferred.promise;
                    }.bind(this));
            } else {
                deferred.reject(new Error('Error! For this privacy level you need to be logged in! Provide username and password!'));
                return deferred.promise;
            }
        } else {
            deferred.reject(new Error('Error! Privacy level is unknown!'));
            return deferred.promise;
        }
    }

    if (typeof expiration !== 'undefined' && expiration !== null) {
        if (!conf.expiration[expiration]) {
            deferred.reject(new Error('Error! Paste expiration ' + expiration + ' is unknown.'));
            return deferred.promise;
        }
        p.api_paste_expire_date = expiration;
    }

    if (noKeyNeeded) {
        return this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.post, p);
    }
    return deferred.promise;
};

/**
 * Create a paste from a file
 * @param  {String}   filename   Location of the filename
 * @param  {String}   title      Title of the paste (optional)
 * @param  {String}   format     Format of the paste, for syntax highlighting. See /lib/config.js (optional)
 * @param  {Number}   privacy    Privacylevel of the paste (0 = public, 1 = unlisted and 2 = private) (optional, default = 0)
 * @param  {String}   expiration Expiration time of the paste See /lib/config.js
 * @return {Object}   Promise
 */
Pastebin.prototype.createPasteFromFile = function (filename, title, format, privacy, expiration) {
    var deferred = Q.defer();

    if (!filename) {
        deferred.reject(new Error('Filename not provided!'));
    }

    fs.readFile(filename, 'UTF8', function (err, data) {
        if (err) {
            deferred.reject(new Error('Readfile error: ' + err));
        }

        this.createPaste(data, title, format, privacy, expiration)
            .then(deferred.resolve)
            .fail(deferred.reject);

    });

    return deferred.promise;
};

/**
 * Delete a paste that is created by the user
 * @param  {String}   pasteID     The id of the userpaste (http://pastebin.com/[id])
 * @return {Object}   Promise
 */
Pastebin.prototype.deletePaste = function (pasteID) {
    var deferred = Q.defer();

    if (!pasteID) {
        deferred.reject(new Error('Please provide a paste ID to delete'));
        return deferred.promise;
    }

    var params = {
        api_option : 'delete',
        api_dev_key : this.config.api_dev_key,
        api_paste_key : pasteID
    };


    if (this.config.api_user_key) {
        params.api_user_key = this.config.api_user_key;
        this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.post, params)
            .then(deferred.resolve)
            .fail(deferred.reject);
    } else if (this.config.api_user_name !== null && this.config.api_user_password !== null) {
        this.createAPIuserKey()
            .then(function () {
                this.deletePaste(pasteID)
                    .then(deferred.resolve)
                    .fail(deferred.reject);
            }.bind(this));
    } else {
        deferred.reject(new Error('Error! Deleting a paste created by the user needs username and password'));
    }

    return deferred.promise;
};

/**
 * Create userkey. Saved in config.api_user_key
 * @return {Object}   Promise
 */
Pastebin.prototype.createAPIuserKey = function () {
    var deferred = Q.defer();

    this._getRequired(['api_dev_key', 'api_user_name', 'api_user_password'])
        .then(function (params) {
            this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.login, params)
                .then(function (data) {
                    if (data.length !== 32) {
                        deferred.reject(new Error('Error in createAPIuserKey! ' + data));
                    } else {
                        this.config.api_user_key = data;
                        deferred.resolve(true);
                    }
                }.bind(this))
                .fail(deferred.reject);
        }.bind(this))
        .fail(deferred.reject);

    return deferred.promise;
};

/**
 * List the pastes that are created by the user
 * @param  {Number}   limit   Set the limit of pastes
 * @return {Object}   Promise
 */
Pastebin.prototype.listUserPastes = function (limit) {
    var deferred = Q.defer();
    var l = limit || 50;

    if (!this.config.api_user_key) {
        this.createAPIuserKey()
            .then(function () {
                this.listUserPastes(limit)
                    .then(deferred.resolve)
                    .fail(deferred.reject);
            }.bind(this))
            .fail(deferred.reject);
    } else {
        var params = {
            api_dev_key : this.config.api_dev_key,
            api_user_key : this.config.api_user_key,
            api_results_limit : l,
            api_option : 'list'
        };
        this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.post, params)
            .then(function (data) {
                this._parsePastes(data)
                    .then(deferred.resolve)
                    .fail(deferred.reject);
            }.bind(this))
            .fail(deferred.reject);
    }

    return deferred.promise;
};

/**
 * Lists the trending pastes
 * @return {Object}   Promise
 */
Pastebin.prototype.listTrendingPastes = function () {
    var deferred = Q.defer();
    var params = {
        api_option : 'trends',
        api_dev_key : this.config.api_dev_key
    };

    this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.post, params)
        .then(function (data) {
            this._parsePastes(data)
                .then(deferred.resolve)
                .fail(deferred.reject);
        }.bind(this))
        .fail(deferred.reject);

    return deferred.promise;
};

/**
 * Gets the info of the user
 * @return {Object}   Promise
 */
Pastebin.prototype.getUserInfo = function () {
    var deferred = Q.defer();
    var params = {
        api_option : 'userdetails',
        api_dev_key : this.config.api_dev_key
    };

    if (!this.config.api_user_key) {
        this.createAPIuserKey()
            .then(function () {
                this.getUserInfo()
                    .then(deferred.resolve)
                    .fail(deferred.reject);
            }.bind(this))
            .fail(deferred.reject);
    } else {
        params.api_user_key = this.config.api_user_key;
        this._postApi(conf.net.protocol + conf.net.base + conf.net.endpoint.post, params)
            .then(function (data) {
                this._parseUser(data)
                    .then(deferred.resolve)
                    .fail(deferred.reject);
            }.bind(this))
            .fail(deferred.reject);
    }

    return deferred.promise;
};

/**
 * Parse an XML file containing pastes
 * @param   {String}    xml     XML
 * @return  {Object}   Promise
 */
Pastebin.prototype._parsePastes = function (xml) {
    var deferred = Q.defer();

    this._parseXML(xml)
        .then(function (data) {
            if (data) {
                var rootObj = data.paste;
                var normalize = _.map(rootObj, function (paste) {
                        var obj = {};
                        _.map(_.keys(paste), function (key) {
                            obj[key] = paste[key][0];
                        });
                        return obj;
                    });
                deferred.resolve(normalize);
            } else {
                deferred.reject(new Error('No data returned to _parsePastes!'));
            }
        })
        .fail(deferred.reject);

    return deferred.promise;
};

/**
 * Parse an XML file containing userdata
 * @param   {String}    xml     XML
 * @return  {Object}   Promise
 */
Pastebin.prototype._parseUser = function (xml) {
    var deferred = Q.defer();

    this._parseXML(xml)
        .then(function (data) {
            if (data) {
                var rootObj = data.user[0];
                var normalize = {};
                _.each(Object.keys(rootObj), function (key) { normalize[key] = rootObj[key][0]; });
                deferred.resolve(normalize);
            } else {
                deferred.reject(new Error('No data returned to _parseUser!'));
            }
        })
        .fail(deferred.reject);

    return deferred.promise;
};

/**
 * Parse an XML file
 * @param   {String}    xml     XML
 * @return  {Object}   Promise
 */
Pastebin.prototype._parseXML = function (xml) {
    var deferred = Q.defer();
    var xmlString = '';
    var parser = new xml2js.Parser({
        'trim' : true,
        'explicitRoot' : false
    });

    if (!xml) {
        deferred.reject(new Error('No xml provided!'));
        return deferred.promise;
    }

    xmlString = '<root>\n' + xml + '</root>\n';
    parser.parseString(xmlString, function (err, data) {
        if (err) {
            deferred.reject(new Error('Error in parsing XML: ' + err));
        } else {
            deferred.resolve(data);
        }
    });

    return deferred.promise;
};

/**
 * Returns a list with the required parameters from config
 * @param   {Array}    paramlist     List of parameters
 */
Pastebin.prototype._getRequired = function (paramlist) {
    var deferred = Q.defer();
    var ret = _.filter(paramlist, function(param) {
        return this.config[param] !== null;
    }.bind(this));

    if (Object.keys(ret).length !== paramlist.length) {
        deferred.reject(new Error('Missing parameters! ' + _.difference(paramlist, ret)));
    } else {
        ret = _.pick(this.config, paramlist);
        deferred.resolve(ret);
    }

    return deferred.promise;
};

/**
 * Higher lever method for get requests
 * @param {String}    path      Path
 * @param {Object}    params    Parameters
 */
Pastebin.prototype._getApi = function (path, params) {
    return method.get(path, params);
};

/**
 * Higher level method for post requests
 * @param {String}    path      Path
 * @param {Object}    params    Parameters
 */
Pastebin.prototype._postApi = function (path, params) {
    return method.post(path, params);
};

module.exports = Pastebin;
