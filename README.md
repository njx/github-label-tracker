[![Build Status](https://travis-ci.org/njx/github-label-tracker.svg?branch=master)](https://travis-ci.org/njx/github-label-tracker)

Utility for tracking changes to GitHub labels over time.

To run this:

* Make sure git is installed and you can do pushes to GitHub.
* `npm install`
* Create a config.json file with these entries:
    * `repo` - the repo whose labels you want to track (e.g. `njx/issue-test-repo`)
    * `labels` - array of labels you want to track; only these labels will be added to the log (e.g. `["Ready", "Development", "Review", "Testing"]`)
    * `storage` - repo where you want to store the log data (e.g. `njx/issue-test-repo-tracking`)
    * `api_key` - a GitHub personal API key (TODO: use app client key / secret)
    * (optional) `initial_timestamp` - the timestamp to use the first time this is run - set this to a time before any workflow labels are added
* `npm start`

When it's done, `storage/log.json` will contain the log, and it will also be pushed
up to the repo specified in `config.storage`. The log is a JSON file:

```
{
    "_timestamp": <the last updated timestamp, as returned by Date.getTime()>,
    <issue number>: {
        <timestamp of event>: {
            "added":   <array of added labels>,
            "removed": <array of removed labels>
        },
        ...
    },
    ...
}
```

See https://github.com/njx/issue-test-repo-tracking/blob/master/log.json for an example.
