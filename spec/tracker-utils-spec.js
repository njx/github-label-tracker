/*
 * Copyright (c) 2014 Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jslint vars: true, plusplus: true, nomen: true, node: true, indent: 4, maxerr: 50 */
/*global expect, describe, it, beforeEach, afterEach, createSpy, waitsFor */

"use strict";

var rewire = require("rewire"),
    _ = require("lodash"),
    Promise = require("bluebird"),
    tracker_utils = rewire("../lib/tracker-utils");

describe("updateLog", function () {
    it("should add an issue to an empty log", function () {
        var log = {},
            newLabels = {
                timestamp: 1,
                issueLabels: {
                    50: ["one", "two"]
                }
            };

        expect(tracker_utils.updateLog(log, newLabels)).toBe(true);
        expect(log.timestamp).toEqual(1);
        expect(log.issueLabels[50].changes).toEqual({
            1: {
                added: ["one", "two"]
            }
        });
        expect(log.issueLabels[50].current).toEqual(["one", "two"]);
    });

    it("should calculate label changes for a single issue, starting with previous log", function () {
        var log = {
                timestamp: 1,
                issueLabels: {
                    50: {
                        changes: {},
                        current: ["one", "two"]
                    }
                }
            },
            newLabels = {
                timestamp: 2,
                issueLabels: {
                    50: ["two", "three"]
                }
            };

        expect(tracker_utils.updateLog(log, newLabels)).toBe(true);
        expect(log.timestamp).toEqual(2);
        expect(log.issueLabels[50].changes).toEqual({
            2: {
                removed: ["one"],
                added: ["three"]
            }
        });
        expect(log.issueLabels[50].current).toEqual(["two", "three"]);
    });

    it("should not record a new timestamp/event for an issue if the labels didn't change (but should update log timestamp if different)", function () {
        var log = {
                timestamp: 1,
                issueLabels: {
                    50: {
                        changes: {},
                        current: ["one", "two"]
                    }
                }
            },
            newLabels = {
                timestamp: 2,
                issueLabels: {
                    50: ["one", "two"]
                }
            };

        expect(tracker_utils.updateLog(log, newLabels)).toBe(true);
        expect(log.timestamp).toEqual(2);
        expect(log.issueLabels[50].changes).toEqual({});
        expect(log.issueLabels[50].current).toEqual(["one", "two"]);
    });
    
    it("should return false from updateLog if the timestamp and labels haven't changed", function () {
        var log = {
                timestamp: 1,
                issueLabels: {
                    50: {
                        changes: {},
                        current: ["one", "two"]
                    }
                }
            },
            newLabels = {
                timestamp: 1,
                issueLabels: {}
            };

        expect(tracker_utils.updateLog(log, newLabels)).toBe(false);
        expect(log.timestamp).toEqual(1);
        expect(log.issueLabels[50].changes).toEqual({});
        expect(log.issueLabels[50].current).toEqual(["one", "two"]);
    });

    it("should merge old and new log data, not modifying issues that are not mentioned in the new data", function () {
        var origLog = {
                timestamp: 1,
                issueLabels: {
                    25: {
                        changes: {
                            1: {
                                removed: ["two"]
                            }
                        },
                        current: ["one"]
                    },
                    50: {
                        changes: {
                            1: {
                                added: ["one"]
                            }
                        },
                        current: ["one", "two"]
                    }
                }
            },
            log = _.cloneDeep(origLog),
            newLabels = {
                timestamp: 2,
                issueLabels: {
                    50: ["two", "three"]
                }
            };

        expect(tracker_utils.updateLog(log, newLabels)).toBe(true);
        expect(log.timestamp).toEqual(2);
        expect(log.issueLabels[25]).toEqual(origLog.issueLabels[25]);
        expect(log.issueLabels[50].changes).toEqual({
            1: {
                added: ["one"]
            },
            2: {
                removed: ["one"],
                added: ["three"]
            }
        });
        expect(log.issueLabels[50].current).toEqual(["two", "three"]);
    });
});

describe("getCurrentLabels", function () {
    var mockConfig,
        mockResponse,
        mockBody,
        requestedOptions;
    
    var mockIssue1347 = {
            "url": "https://api.github.com/repos/octocat/Hello-World/issues/1347",
            "number": 1347,
            "labels": [
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/bug",
                    "name": "bug",
                    "color": "f29513"
                },
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/Ready",
                    "name": "Ready",
                    "color": "f29513"
                }
            ],
            "created_at": "2011-04-22T13:33:48Z",
            "updated_at": "2011-04-22T13:33:48Z"
        },
        mockIssue1350 = {
            "url": "https://api.github.com/repos/octocat/Hello-World/issues/1350",
            "number": 1350,
            "labels": [
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/Development",
                    "name": "Development",
                    "color": "f29513"
                },
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/enhancement",
                    "name": "enhancement",
                    "color": "f29513"
                }
            ],
            "created_at": "2011-04-22T13:35:49Z",
            "updated_at": "2011-04-22T13:35:49Z"
        };

    beforeEach(function () {
        var responseIndex = 0;
        
        requestedOptions = [];
        mockConfig = {
            repo: "my/repo",
            labels: ["Ready", "Development"],
            api_key: "FAKE_KEY"
        };
        mockResponse = {
            statusCode: 200
        };
        tracker_utils.__set__("request", function (options) {
            if ((Array.isArray(mockResponse) && responseIndex >= mockResponse.length) ||
                    (Array.isArray(mockBody) && responseIndex >= mockBody.length)) {
                return Promise.reject(new Error("Tried to request more times than was expected"));
            }
            requestedOptions.push(_.cloneDeep(options));
            var response = (Array.isArray(mockResponse) ? mockResponse[responseIndex] : mockResponse),
                body = (Array.isArray(mockBody) ? mockBody[responseIndex] : mockBody);
            responseIndex++;
            return Promise.resolve([response, body]);
        });
    });

    it("should fetch the issues for a repo from GitHub and return the tracked labels in the correct format", function (done) {
        // This isn't all the content from a GitHub response, just the stuff we should care about.
        mockBody = JSON.stringify([mockIssue1347, mockIssue1350]);
        
        tracker_utils.getCurrentLabels(mockConfig, 100)
            .then(function (labels) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.since).toEqual(new Date(100).toISOString());
                expect(labels).toEqual({
                    timestamp: Date.parse("2011-04-22T13:35:49Z"),
                    issueLabels: {
                        1347: ["Ready"],
                        1350: ["Development"]
                    }
                });
                done();
            });
    });
    
    it("should handle an unspecified initial timestamp", function (done) {
        mockBody = JSON.stringify([mockIssue1350]);
        
        tracker_utils.getCurrentLabels(mockConfig)
            .then(function (labels) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.since).toBeUndefined();
                expect(labels).toEqual({
                    timestamp: Date.parse("2011-04-22T13:35:49Z"),
                    issueLabels: {
                        1350: ["Development"]
                    }
                });
                done();
            });
    });
    
    it("should default to specified 'since' timestamp if there are no updates", function (done) {
        mockBody = "[]";
        
        tracker_utils.getCurrentLabels(mockConfig, 100)
            .then(function (labels) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.since).toEqual(new Date(100).toISOString());
                expect(labels).toEqual({
                    timestamp: 100,
                    issueLabels: {}
                });
                done();
            });
    });
    
    it("should request multiple pages, accumulating items from them", function (done) {
        mockBody = [
            JSON.stringify([mockIssue1347]),
            JSON.stringify([mockIssue1350])
        ];
        mockResponse = [
            {
                statusCode: 200,
                headers: {
                    "link": "<https://api.github.com/repos/my/repo/issues?page=2&per_page=100>; rel=\"next\", <https://api.github.com/repos/my/repo/issues?page=2&per_page=100>; rel=\"last\""
                }
            },
            {
                statusCode: 200
            }
        ];
        
        tracker_utils.getCurrentLabels(mockConfig, 100)
            .then(function (labels) {
                var i;
                for (i = 0; i < 2; i++) {
                    expect(requestedOptions[i].url).toEqual("https://api.github.com/repos/my/repo/issues");
                    expect(requestedOptions[i].qs.access_token).toEqual(mockConfig.api_key);
                    expect(requestedOptions[i].qs.since).toEqual(new Date(100).toISOString());
                    expect(requestedOptions[i].qs.per_page).toEqual(100);
                }
                expect(requestedOptions[0].qs.page).toBeUndefined();
                expect(requestedOptions[1].qs.page).toEqual("2");
             
                expect(labels).toEqual({
                    timestamp: Date.parse("2011-04-22T13:35:49Z"),
                    issueLabels: {
                        1347: ["Ready"],
                        1350: ["Development"]
                    }
                });
                done();
            });
    });
});