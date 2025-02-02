/* <copyright>
Copyright (c) 2012, Motorola Mobility LLC.
All Rights Reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice,
  this list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of Motorola Mobility LLC nor the names of its
  contributors may be used to endorse or promote products derived from this
  software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
</copyright> */

var Q = require("bluebird-q");
var FS = require("q-io/fs");
var HTTP = require("q-io/http");
var Apps = require("q-io/http-apps");
var Route = require("./lib/route");

var Chain = function (end) {
    var self = Object.create(Chain.prototype);
    self.end = end || function (next) {
        return next;
    };
    return self;
};

var chain = Chain.prototype;


// Primitives

chain.use = function (App /*, ...args*/) {
    var args = Array.prototype.slice.call(arguments, 1);
    this.end = (function (End) {
        return function (next) {
            return End(App.apply(null, [next].concat(args)));
        };
    })(this.end);
    return this;
};

chain.terminate = function () {
    if (!this.use) {
        throw new Error("Cannot add links a terminated chain.");
    }
    var result = this.use.apply(this, arguments);
    // forcibly prevent any further chaining
    this.use = null;
    return result;
};

chain.add = function (App, name) {
    name = App.name || name;
    name = name[0].toLowerCase() + name.slice(1);
    this[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        return this.use.apply(
            this,
            [App].concat(args)
        );
    };
};


// Middleware

chain.blah =
chain.blahblah =
chain.blahblahblah =
chain.useCommon =
chain.common =
function (options) {
    options = options || {};
    return this
    .time()
    .favicon(options.favicon)
    .error(options.debug)
    .log(options.log, options.stamp)
    .parseQuery()
    .normalize()
};


// Create easy "use" wrappers for all of the following middleware
[
    "Tap",
    "Trap",
    "Error",
    "Log",
    "Headers", // TODO document in README
    "Date", // TODO document in README
    "Permanent", // TODO document in README
    "Time", // TODO document in README.md
    "Normalize", // TODO document in README.md
    "RedirectTrap",
    "CookieJar",
    "ParseQuery", // TODO document in README.md
    "DirectoryIndex",
    "ListDirectories",
    "HandleHtmlFragmentResponses",
    "HandleJsonResponses"
].forEach(function (name) {
    chain.add(Apps[name], name);
});

// TODO document in README.md
chain.cors = function (origin, methods, headers) {
    var include = {
        "access-control-allow-origin": origin || "*"
    };
    if (methods) {
        if (Array.isArray(methods))
            methods = methods.join(", ");
        include["access-control-allow-methods"] = methods;
    }
    if (headers) {
        if (Array.isArray(headers))
            headers = headers.join(", ");
        include["access-control-allow-headers"] = headers;
    }
    return this.headers(include);
};

chain.favicon = function (path) {
    var app;
    // TODO vanity icon
    if (path) {
        path = FS.join(arguments);
        app = Apps.File(path);
    } else {
        app = Apps.notFound;
    }
    return this.use(function (next) {
        return function (request, response) {
            if (request.pathInfo === "/favicon.ico") {
                return app(request, response);
            } else {
                return next(request, response);
            }
        };
    });
};


// Routing and Negotiation

chain.route = function (prefix, setup) {
    return this.use(Route.Setup(this, prefix, setup));
};

chain.branch = function (paths) {
    return this.use(function (next) {
        return Apps.Branch(paths, next);
    });
};

var Multiplex = function (Using) {
    return function (setup) {
        var branches = {};
        var chain = this;
        setup(function () {
            var branch = new chain.constructor();
            Array.prototype.forEach.call(arguments, function (name) {
                branches[name] = branch;
            });
            return branch;
        });
        return this.use(function (next) {
            Object.keys(branches).forEach(function (name) {
                var branch = branches[name];
                branches[name] = branch.end();
            });
            return Using(branches, next);
        });
    };
};

var Constrain = function (Using) {
    return function () {
        var args = arguments;
        var types = {};
        return this.use(function (next) {
            Array.prototype.forEach.call(args, function (type) {
                types[type] = next;
            });
            return Using(types);
        });
    }
};

chain.method = Constrain(Apps.Method);
chain.methods = Multiplex(Apps.Method);
chain.contentType = Constrain(Apps.ContentType);
chain.contentTypes = Multiplex(Apps.ContentType);
chain.language = Constrain(Apps.Language);
chain.languages = Multiplex(Apps.Language);
chain.charset = Constrain(Apps.Charset);
chain.charsets = Multiplex(Apps.Charset);
chain.encoding = Constrain(Apps.Encoding);
chain.encodings = Multiplex(Apps.Encoding);
chain.host = Constrain(Apps.Host);
chain.hosts = Multiplex(Apps.Host);


// Endware

chain.cap = function (notFound) {
    return this.use(function (next) {
        return Apps.Cap(next, notFound);
    });
};

chain.app = function (app) {
    return this.terminate(function () {
        return app;
    });
};

chain.contentApp = function (app) {
    return this.terminate(function () {
        return function (request, response) {
            return Q.when(app(request, response), function (content) {
                return Apps.ok(content);
            });
        };
    });
};

chain.proxy = function (app) {
    return this.use(function () {
        return Apps.Proxy(app);
    });
};

chain.proxyTree = function (app) {
    return this.use(function () {
        return Apps.ProxyTree(app);
    });
};

['badRequest', 'notFound', 'methodNotAllowed', 'notAcceptable']
.forEach(function (name) {
    var app = Apps[name];
    chain[name] = function (app) {
        return this.app(app);
    };
});

chain.nap = function (nodeApp) {
    return this.terminate(function () {
        return function (request, response) {
            nodeApp(request.nodeRequest, response.nodeResponse || response);
        };
    });
};

chain.ok =
chain.content = function (body, contentType, status) {
    if (!Array.isArray(body)) {
        body = [body];
    }
    return this.terminate(function () {
        return Apps.Content(body, contentType, status);
    });
};

chain.file = function (path, contentType, fs) {
    return this.terminate(function () {
        return Apps.File(path, contentType, fs);
    });
};

chain.fileTree = function (root, options) {
    return this.terminate(function (next) {
        options = options || {};
        options.notFound = next;
        return Apps.FileTree(root, options);
    });
};

chain.redirect = function (path) {
    return this.terminate(function () {
        return Apps.Redirect(path);
    });
};

chain.redirectTree = function (path) {
    return this.terminate(function () {
        return Apps.RedirectTree(path);
    });
};

chain.redirectPermanent =
chain.permanentRedirect = function (path, status) {
    return this.terminate(function () {
        return Apps.PermanentRedirect(path, status);
    });
};

chain.redirect =
chain.redirectTemporary =
chain.temporaryRedirect = function (path, status) {
    return this.terminate(function () {
        return Apps.TemporaryRedirect(path, status);
    });
};


// Preprocessing

chain.contentRequest = function () {
    return this.use(Apps.ContentRequest);
};

chain.jsonRequest = function (visitor, tabs) {
    return this.use(function (next) {
        return Apps.JsonRequest(next, visitor, tabs);
    });
};


// Postprocessing

chain.json = function (visitor, tabs) {
    return this.use(function (next) {
        return Apps.Json(next, visitor, tabs);
    });
};


// Enders

chain.client = function () {
    return this.end(HTTP.request);
};

chain.server = function () {
    return HTTP.Server(this.end())
};

chain.listen = function (port, host) {
    var server = this.server();
    return server.listen.apply(server, arguments);
};


// Extender

chain.extend = function (extension) {
    var prototype = Object.create(this, {
        "constructor": {
            "value": function (appMaker) {
                return Object.create(prototype);
            }
        }
    });
    for (var name in extension) {
        prototype[name] = extension[name];
    }
    return prototype;
};

// Adds functions that create responders
chain.install = function () {
    var properties = {};
    Array.prototype.forEach.call(arguments, function (arg) {
        if (typeof arg === "object") {
            var makers = arg;
            Object.keys(makers).forEach(function (key) {
                var maker = makers[key];
                properties[key] = function () {
                    var args = arguments;
                    return this.use(function (next) {
                        return maker.apply(this, args);
                    });
                };
            });
        } else if (typeof arg === "function") {
            var maker = arg;
            properties[maker.name] = function () {
                var args = arguments;
                return this.use(function (next) {
                    return maker.apply(this, args);
                });
            };
        }
    });
    return this.extend(properties);
};


// exports

// proxy all the chain methods, doing a .create() first
// to start a chain.
for (name in chain) {
    if (Object.prototype.hasOwnProperty.call(chain, name)) {
        (function (name) {
            exports[name] = function () {
                var chain = exports.create();
                return chain[name].apply(chain, arguments);
            }
        })(name);
    }
}

exports.create = function (prefix, setup) {
    var chain = Chain();
    if (prefix) {
        chain = chain.route(prefix, setup);
    }
    return chain;
};

