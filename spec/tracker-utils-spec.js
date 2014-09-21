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

/*global expect, describe, it, beforeEach, afterEach, createSpy, waitsFor */

"use strict";

var rewire = require("rewire"),
    _ = require("lodash"),
    Promise = require("bluebird"),
    tracker_utils = rewire("../lib/tracker-utils");

describe("updateLog", function () {
    var config = {
        labels: ["one", "two", "three"]
    };

    it("should add an issue to an empty log", function () {
        var log = {},
            db = {
                timestamp: 1,
                issues: {
                    50: {
                        labels: ["one", "two"]
                    }
                },
                latestUpdates: {
                    issues: [50],
                    pulls: []
                },
            };

        tracker_utils.updateLog(config, log, db);
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
            db = {
                timestamp: 2,
                issues: {
                    50: {
                        labels: ["two", "three"]
                    }
                },
                latestUpdates: {
                    issues: [50],
                    pulls: []
                }
            };

        tracker_utils.updateLog(config, log, db);
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
            db = {
                timestamp: 2,
                issues: {
                    50: {
                        labels: ["one", "two"]
                    }
                },
                latestUpdates: {
                    issues: [50],
                    pulls: []
                }
            };

        tracker_utils.updateLog(config, log, db);
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
            db = {
                timestamp: 2,
                issues: {
                    50: {
                        labels: ["one", "two"]
                    }
                },
                latestUpdates: {
                    issues: [],
                    pulls: []
                }
            };

        tracker_utils.updateLog(config, log, db);
        expect(log.timestamp).toEqual(2);
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
            db = {
                timestamp: 2,
                issues: {
                    50: {
                        labels: ["two", "three"]
                    }
                },
                latestUpdates: {
                    issues: [50],
                    pulls: []
                }
            };

        tracker_utils.updateLog(config, log, db);
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
    
    it("should add in basic pull request info", function () {
        var log = {},
            prs = {
                1099: {
                    prState: tracker_utils.PR_STATE_NEW
                }
            },
            db = {
                timestamp: 10,
                issues: {
                    1099: {
                        createdAt: 2,
                        type: "pull"
                    }
                },
                latestUpdates: {
                    issues: [],
                    pulls: [1099]
                }
            };
        tracker_utils.updateLog(config, log, db);
        expect(log.pullRequests).toEqual(prs);
    });
    
    it("should merge comment info", function () {
        var log = {
            timestamp: 10,
            pullRequests: {
                1099: {
                }
            }
        },
            db = {
                timestamp: 10,
                issues: {
                    1099: {
                        type: "pull",
                        user: "TheRequestor",
                        assignee: "TheAssignee"
                    }
                },
                latestUpdates: {
                    issues: [],
                    pulls: [1099]
                }
            },
            latestComments = {
                timestamp: 10,
                prCommentTimestamps: [
                    {
                        id: 1099,
                        user: "ACommenter",
                        created: Date.parse("2014-06-10T18:35:37Z")
                    },
                    {
                        id: 1099,
                        user: "TheRequestor",
                        created: Date.parse("2014-06-09T10:10:10Z")
                    },
                    {
                        id: 1099,
                        user: "TheAssignee",
                        created: Date.parse("2014-06-08T09:09:09Z")
                    },
                    {
                        id: 999,
                        user: "DoesNotMatter",
                        created: Date.parse("2014-06-07T08:08:08Z")
                    }
                ]
            };
        tracker_utils.updateLog(config, log, db, latestComments);
        expect(log.pullRequests[1099].latestUserComment).toEqual(Date.parse("2014-06-09T10:10:10Z"));
        expect(log.pullRequests[1099].latestAssigneeComment).toEqual(Date.parse("2014-06-08T09:09:09Z"));
    });
    
    it("should delete closed pull requests", function () {
        var log = {
            pullRequests: {
                1099: {
                    title: "Shiny Pull Request",
                    created: 5,
                    user: "TheRequestor",
                    assignee: "TheAssignee",
                    state: tracker_utils.PR_STATE_NEW
                }
            }
        },
            db = {
                timestamp: 10,
                issues: {
                    1099: {
                        title: "Shiny Pull Request",
                        createdAt: 5,
                        user: "TheRequestor",
                        assignee: "TheAssignee",
                        state: "closed"
                    }
                },
                latestUpdates: {
                    issues: [],
                    pulls: [1099]
                }
            };
        tracker_utils.updateLog(config, log, db);
        expect(log.pullRequests).toEqual({});
    });
});

describe("getLatestIssueInfo", function () {
    var mockConfig,
        mockResponse,
        mockBody,
        requestedOptions,
        oldRequestObject;
    
    var mockIssue1347 = {
            "url": "https://api.github.com/repos/octocat/Hello-World/issues/1347",
            "number": 1347,
            "title": "1347 was a good year. I guess.",
            "user": {
                login: "ABracketsUsers"
            },
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
            "title": "The Exciting 1350",
            "user": {
                login: "ABracketsDeveloper"
            },
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
        },
        mockPR1352 = {
            "url": "https://api.github.com/repos/octocat/Hello-World/issues/1352",
            "number": 1352,
            "title": "Makes the frobbitz less susceptible to frammis",
            "labels": [
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/PR Triage complete",
                    "name": "PR Triage complete",
                    "color": "f29513"
                }
            ],
            "user": {
                "login": "UserThatCreated"
            },
            "created_at": "2011-04-22T13:35:49Z",
            "updated_at": "2011-04-22T13:35:49Z",
            "assignee": null,
            "pull_request": {
                "url": "https://api.github.com/repos/octocat/Hello-World/pulls/1352",
                "html_url": "https://github.com/octocat/Hello-World/pull/1352",
                "diff_url": "https://github.com/octocat/Hello-World/pull/1352.diff",
                "patch_url": "https://github.com/octocat/Hello-World/pull/1352.patch"
            },
            "state": "open",
        },
        mockPR1353 = {
            "url": "https://api.github.com/repos/octocat/Hello-World/issues/1353",
            "number": 1353,
            "title": "Take care of those nasty hobbitses",
            "labels": [
                {
                    "url": "https://api.github.com/repos/octocat/Hello-World/labels/PR Triage complete",
                    "name": "PR Triage complete",
                    "color": "f29513"
                }
            ],
            "user": {
                "login": "UserThatCreated"
            },
            "created_at": "2011-04-22T13:35:49Z",
            "updated_at": "2011-04-22T13:35:49Z",
            "assignee": {
                "login": "ThePersonWhoIsAssigned"
            },
            "pull_request": {
                "url": "https://api.github.com/repos/octocat/Hello-World/pulls/1353",
                "html_url": "https://github.com/octocat/Hello-World/pull/1353",
                "diff_url": "https://github.com/octocat/Hello-World/pull/1353.diff",
                "patch_url": "https://github.com/octocat/Hello-World/pull/1353.patch"
            },
            "state": "open"
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
        oldRequestObject = tracker_utils.__get__("request");
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
    
    afterEach(function () {
        tracker_utils.__set__("request", oldRequestObject);
    });

    it("should fetch the issues for a repo from GitHub and return the tracked labels in the correct format", function (done) {
        // This isn't all the content from a GitHub response, just the stuff we should care about.
        mockBody = JSON.stringify([mockIssue1347, mockIssue1350]);
        var db = {
            timestamp: 100,
            issues: {},
            pulls: {}
        };
        
        tracker_utils.getLatestIssueInfo(mockConfig, db)
            .then(function (db) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.since).toEqual(new Date(100).toISOString());
                expect(db.timestamp).toEqual(Date.parse("2011-04-22T13:35:49Z"));
                expect(db.issues[1347].createdAt).toBe(Date.parse("2011-04-22T13:33:48Z"));
                expect(db.issues[1347].labels).toEqual(["bug", "Ready"]);
                expect(db.issues[1350].labels).toEqual(["Development", "enhancement"]);
                expect(db.issues[1347].type).toBe("issue");
                expect(db.latestUpdates.issues).toEqual([1347, 1350]);
                done();
            });
    });
    
    it("should handle an unspecified initial timestamp", function (done) {
        mockBody = JSON.stringify([mockIssue1350]);
        
        var db = {
            issues: {},
            pulls: {}
        };
        
        tracker_utils.getLatestIssueInfo(mockConfig, db)
            .then(function (currentInfo) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.since).toBeUndefined();
                expect(db.issues[1350].title).toEqual("The Exciting 1350");
                expect(db.latestUpdates.issues).toEqual([1350]);
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
        
        var db = {
            timestamp: 100,
            issues: {},
            pulls: {}
        };
        
        tracker_utils.getLatestIssueInfo(mockConfig, db)
            .then(function (currentInfo) {
                var i;
                for (i = 0; i < 2; i++) {
                    expect(requestedOptions[i].url).toEqual("https://api.github.com/repos/my/repo/issues");
                    expect(requestedOptions[i].qs.access_token).toEqual(mockConfig.api_key);
                    expect(requestedOptions[i].qs.since).toEqual(new Date(100).toISOString());
                    expect(requestedOptions[i].qs.per_page).toEqual(100);
                }
                expect(requestedOptions[0].qs.page).toBeUndefined();
                expect(requestedOptions[1].qs.page).toEqual("2");
             
                expect(db.timestamp).toEqual(Date.parse("2011-04-22T13:35:49Z"));
                expect(db.issues[1350].title).toEqual("The Exciting 1350");
                done();
            });
    });
    
    it("should return pull request data for new PRs", function (done) {
        mockBody = [
            JSON.stringify([mockPR1352])
        ];
        
        var db = {
            issues: {}
        };
        
        tracker_utils.getLatestIssueInfo(mockConfig, db)
            .then(function (currentInfo) {
                expect(db.timestamp).toBe(Date.parse("2011-04-22T13:35:49Z"));
            
                var pull = db.issues[1352];
                expect(pull.labels).toEqual(["PR Triage complete"]);
                expect(pull.title).toEqual(mockPR1352.title);
                expect(pull.assignee).toBeNull();
                expect(pull.user).toBe("UserThatCreated");
                expect(pull.createdAt).toBe(Date.parse("2011-04-22T13:35:49Z"));
                expect(db.latestUpdates.pulls).toEqual([1352]);
                done();
            });
    });
});

describe("getLatestCommentInfo", function () {
    var mockConfig,
        mockResponse,
        mockBody,
        requestedOptions,
        oldRequestObject;


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
    
    afterEach(function () {
        tracker_utils.__set__("request", oldRequestObject);
    });
    
    var comment1 = {
        "url": "https://api.github.com/repos/octocat/Hello-World/issues/comments/1",
        "html_url": "https://github.com/octocat/Hello-World/pull/22#issuecomment-1",
        "issue_url": "https://api.github.com/repos/octocat/Hello-World/issues/22",
        "id": 1,
        "user": {
            "login": "ACommenter"
        },
        "created_at": "2014-06-10T18:35:37Z",
        "updated_at": "2014-06-10T18:35:37Z",
        "body": "I like saying hello."
    };
    
    var comment2 = {
        "url": "https://api.github.com/repos/octocat/Hello-World/issues/comments/2",
        "html_url": "https://github.com/octocat/Hello-World/issues/33#issuecomment-2",
        "issue_url": "https://api.github.com/repos/octocat/Hello-World/issues/33",
        "id": 2,
        "user": {
            "login": "AnIssueCommenter"
        },
        "created_at": "2014-06-10T18:31:43Z",
        "updated_at": "2014-06-10T18:31:43Z",
        "body": "I'd just like to say cheese."
    };
    
    var comment3 = {
        "url": "https://api.github.com/repos/octocat/Hello-World/issues/comments/3",
        "html_url": "https://github.com/octocat/Hello-World/pull/44#issuecomment-3",
        "issue_url": "https://api.github.com/repos/octocat/Hello-World/issues/44",
        "id": 3,
        "user": {
            "login": "AnIssueCommenter"
        },
        "created_at": "2011-06-10T18:31:43Z",
        "updated_at": "2011-06-10T18:31:43Z",
        "body": "This is an oldie, but goodie."
    };
    
    it("should fetch the comments for a repo from GitHub and return the comment data in the correct format", function (done) {
        // This isn't all the content from a GitHub response, just the stuff we should care about.
        mockBody = JSON.stringify([comment1, comment2]);

        tracker_utils.getLatestComments(mockConfig, 100)
            .then(function (latestComments) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues/comments");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.sort).toEqual("created");
                expect(requestedOptions[0].qs.direction).toEqual("desc");
                expect(requestedOptions[0].qs.since).toEqual(new Date(100).toISOString());
                expect(latestComments).toEqual({
                    timestamp: Date.parse("2014-06-10T18:35:37Z"),
                    prCommentTimestamps: [
                        {
                            id: 22,
                            user: "ACommenter",
                            created: Date.parse("2014-06-10T18:35:37Z")
                        }
                    ]
                });
                done();
            });
    });
    
    it("should request multiple pages, accumulating items from them", function (done) {
        mockBody = [
            JSON.stringify([comment2]),
            JSON.stringify([comment1])
        ];
        mockResponse = [
            {
                statusCode: 200,
                headers: {
                    "link": "<https://api.github.com/repos/my/repo/comments?page=2&per_page=100>; rel=\"next\", <https://api.github.com/repos/my/repo/comments?page=2&per_page=100>; rel=\"last\""
                }
            },
            {
                statusCode: 200
            }
        ];

        tracker_utils.getLatestComments(mockConfig, 100)
            .then(function (latestComments) {
                var i;
                for (i = 0; i < 2; i++) {
                    expect(requestedOptions[i].url).toEqual("https://api.github.com/repos/my/repo/issues/comments");
                    expect(requestedOptions[i].qs.access_token).toEqual(mockConfig.api_key);
                    expect(requestedOptions[i].qs.since).toEqual(new Date(100).toISOString());
                    expect(requestedOptions[i].qs.per_page).toEqual(100);
                }
                expect(requestedOptions[0].qs.page).toBeUndefined();
                expect(requestedOptions[1].qs.page).toEqual("2");

                expect(latestComments).toEqual({
                    timestamp: Date.parse("2014-06-10T18:35:37Z"),
                    prCommentTimestamps: [
                        {
                            id: 22,
                            user: "ACommenter",
                            created: Date.parse("2014-06-10T18:35:37Z")
                        }
                    ]
                });
                done();
            });
    });
    
    it("should stop when it hits a six month old comment on firstRun", function (done) {
        // This isn't all the content from a GitHub response, just the stuff we should care about.
        mockBody = JSON.stringify([comment1, comment3]);
        
        mockConfig.firstRun = true;
        tracker_utils.getLatestComments(mockConfig, 100)
            .then(function (latestComments) {
                expect(requestedOptions[0].url).toEqual("https://api.github.com/repos/my/repo/issues/comments");
                expect(requestedOptions[0].qs.access_token).toEqual(mockConfig.api_key);
                expect(requestedOptions[0].qs.sort).toEqual("created");
                expect(requestedOptions[0].qs.direction).toEqual("desc");
                expect(requestedOptions[0].qs.since).toEqual(new Date(100).toISOString());
                expect(latestComments).toEqual({
                    timestamp: Date.parse("2014-06-10T18:35:37Z"),
                    prCommentTimestamps: [
                        {
                            id: 22,
                            user: "ACommenter",
                            created: Date.parse("2014-06-10T18:35:37Z")
                        }
                    ]
                });
                done();
            });
    });
});