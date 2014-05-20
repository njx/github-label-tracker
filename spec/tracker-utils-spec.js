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
                _timestamp: 1,
                50: ["one", "two"]
            };

        tracker_utils.updateLog(log, newLabels);
        expect(log._timestamp).toEqual(1);
        expect(log[50]).toEqual({
            1: {
                added: ["one", "two"]
            },
            labels: ["one", "two"]
        });
    });

    it("should calculate label changes for a single issue, starting with previous log", function () {
        var log = {
                _timestamp: 1,
                50: {
                    labels: ["one", "two"]
                }
            },
            newLabels = {
                _timestamp: 2,
                50: ["two", "three"]
            };

        tracker_utils.updateLog(log, newLabels);
        expect(log._timestamp).toEqual(2);
        expect(log[50]).toEqual({
            2: {
                removed: ["one"],
                added: ["three"]
            },
            labels: ["two", "three"]
        });
    });

    it("should not record a new timestamp/event for an issue if the labels didn't change (but should update log timestamp)", function () {
        var log = {
                _timestamp: 1,
                50: {
                    labels: ["one", "two"]
                }
            },
            newLabels = {
                _timestamp: 2,
                50: ["one", "two"]
            };

        tracker_utils.updateLog(log, newLabels);
        expect(log._timestamp).toEqual(2);
        expect(log[50]).toEqual({
            labels: ["one", "two"]
        });
    });

    it("should merge old and new log data, not modifying issues that are not mentioned in the new data", function () {
        var origLog = {
                _timestamp: 1,
                25: {
                    1: {
                        removed: ["two"]
                    },
                    labels: ["one"]
                },
                50: {
                    1: {
                        added: ["one"]
                    },
                    labels: ["one", "two"]
                }
            },
            log = _.cloneDeep(origLog),
            newLabels = {
                _timestamp: 2,
                50: ["two", "three"]
            };

        tracker_utils.updateLog(log, newLabels);
        expect(log._timestamp).toEqual(2);
        expect(log[25]).toEqual(origLog[25]);
        expect(log[50]).toEqual({
            1: {
                added: ["one"]
            },
            2: {
                removed: ["one"],
                added: ["three"]
            },
            labels: ["two", "three"]
        });
    });
});

describe("getCurrentLabels", function () {
    var requestedOptions, mockResponse, mockBody;

    beforeEach(function () {
        tracker_utils.__set__("request", function (options) {
            requestedOptions = options;
            return Promise.resolve([mockResponse, mockBody]);
        });
    });

    it("should fetch the issues for a repo from GitHub and return the tracked labels in the correct format", function (done) {
        mockResponse = {
            statusCode: 200
        };
        // This isn't all the content from a GitHub response, just the stuff we should care about.
        mockBody = JSON.stringify([
            {
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
            {
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
            }
        ]);
        
        var mockConfig = {
            repo: "my/repo",
            labels: ["Ready", "Development"],
            api_key: "FAKE_KEY"
        };
        
        tracker_utils.getCurrentLabels(mockConfig, 100)
            .then(function (labels) {
                expect(requestedOptions.url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions.qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions.qs.since).toEqual(new Date(100).toISOString());
                expect(labels).toEqual({
                    _timestamp: Date.parse("2011-04-22T13:35:49Z"),
                    1347: ["Ready"],
                    1350: ["Development"]
                });
                done();
            });
    });
});