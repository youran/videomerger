var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var child_process = require('child_process');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

var port = 1000;
var router = express.Router();

// database
var mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/videoTasks');
var videoTask = require('./models/videotask');

// global task array
var taskArray = [];

// set a timer to watch for status of tasks
var interval = setInterval(function() {
    taskArray.forEach(function(task, index){
        videoTask.findOne({taskId: task.id}, function(err, doc){
            if (err) {
                console.log('ROUTINE: videoTask.findOne failed!');
            } else {
                // skip invalid(error or already in processing) tasks
                if (doc.downloadError === true || doc.mergeError === true
                    || doc.downloadComplete === true || doc.mergeComplete === true) {
                    return;
                }
                
                // fetch status of all wget processes in a task
                var allWgetCompleted = true;
                task.wget.forEach(function(wget, index){
                    if (wget.complete === false) {
                        allWgetCompleted = false;
                    }
                });
                
                // if all parts downloaded, set the downloadComplete flag,
                // and fork a videomerge child-process
                if (allWgetCompleted === true) {
                    doc.downloadComplete = true;
                    doc.save();

                    if (task.wget.length === undefined || task.wget.length < 2) {
                        return;
                    }
                    var ffpmegProc = child_process.fork('./ffmpeg.js', [doc.taskId, task.wget.length]);
                    var ffmpegObj = {complete: false, error: false, proc: ffpmegProc};
                    task.ffmpeg.push(ffmpegObj);
                    console.log('forked ffmpeg process, id=' + doc.taskId + ', fileNum=' + task.wget.length);

                    // communicate with child process
                    ffpmegProc.on('message', function(msg){
                        if (msg.complete === true) {
                            ffmpegObj.complete = true;
                            doc.mergeComplete = true;    // when true, the whole processing complete
                            doc.filePath = msg.filePath;
                            doc.save();
                        }

                        if (msg.error === true) {
                            ffmpegObj.error = true;
                            doc.mergeError = true;
                            doc.save();
                        }
                    });
                }
            }
        });
    });
}, 5000);   // check database every 5 seconds

// middleware to use for all requests
router.use(function(req, res, next) {
    // do logging
    console.log('Request is coming.');
    next();
});

// hello message
router.get('/', function(req, res) {
    res.json({message:'a web service for net video'});
});

// Router. Actual process starts here
router.route('/tasks')
// GET /tasks    list all tasks
.get(function(req, res){
    videoTask.find(function(err, tasks){
        if (err) {
            res.json({result:'Error fetching tasks.'});
            return;
        }
        res.json(tasks);
    });
})

// POST /tasks    add a task
.post(function(req, res){
    // initialize database entry
    var newTask = new videoTask();
    newTask.downloadComplete = false;
    newTask.downloadError = false;
    newTask.mergeComplete= false;
    newTask.mergeError = false;
    newTask.filePath = '';

    // create an id for each task
    var id = Date.now();
    newTask.taskId = id;

    // save task properties to database
    var saved = true;
    newTask.save(function(err){
        if (err) {
            res.json({result: 'error'});
            saved = false;
        } else {
            console.log('taskId = '+ id);
        }
    });
    if (saved === false) {
        return;
    }

    // register task to taskArray
    var taskObj = {id: id, wget: [], ffmpeg: []};
    taskArray.push(taskObj);

    // populate urls first
    console.log('req.body = ' + req.body);
    var urls = [];
    for (var key in req.body) {
        // skip loop if the property is from prototype
        if (!req.body.hasOwnProperty(key)) continue;

        urls.push(req.body[key]);
    }

    // fork wget child-processes to do the download
    urls.forEach(function(url, index) {
        console.log('creating wget process for: ' + url + ', index=' + index);
        var wgetProc = child_process.fork('./wget.js', [url, id, index]);
        var wgetObj = {complete: false, error: false, proc: wgetProc};
        taskObj.wget.push(wgetObj);

        // communicate with child process
        wgetProc.on('message', function(msg){
            if (msg.progress !== undefined) {
                //TODO: retrieve progress from child
            }

            if (msg.complete === true) {
                wgetObj.complete = true;
            }

            if (msg.error === true) {
                wgetObj.error = true;
                newTask.downloadError = true;
                newTask.save();
            }
        });
    });

    res.json({result: 'accepted', taskId: id});
    console.log('POST tasks complete');
});

// status enquiry by taskId
router.route('/tasks/:taskId')
.get(function(req, res) {
    // fetch download url in database
    videoTask.findOne({taskId: req.params.taskId}, function(err, doc) {
        if (err) {
            res.json({result: 'error'});
            return;
        }
        
        if (!doc) {
            res.json({result : 'not found'});
            return;
        }

        if (doc.downloadError === true) {
            res.json({result: 'download error'});
            return;
        }

        if (doc.mergeError === true) {
            res.json({result: 'merge error'});
            return;
        }

        if (doc.downloadError === false && doc.mergeError === false && doc.mergeComplete === false){
            var count = 0, total = 0;
            // look up download progress in task array
            taskArray.forEach(function(task, index){
                if (task.id === req.params.taskId) {
                    task.wget.forEach(function(proc, index){
                        if (proc.error === true ) {    // not likely, just in case
                            res.json({result: 'download error'});
                        }

                        if (proc.complete === true) {
                            count++;
                        }
                    });
                    total = task.wget.length;
                }
            });

            res.json({result: 'downloading', count: count, total: total});
            return;
        }

        if (doc.downloadComplete === true && doc.mergeComplete === false) {
            res.json({result: 'merging'});
            return;
        }

        if (doc.mergeComplete === true) {
            var fileName = doc.filePath.split('/').pop();
            var url = 'http://your/server/address/' + fileName;
            res.json({result: 'complete', url: url});
        }
    });
})
// DEL /tasks/:task_id  terminate and delete a task
.delete(function(req, res) {
    // find task by id
    var id = parstInt(req.params.task_id, 10);
    videoTask.remove({taskId: id}, function(err, doc){
        if (err) {
            res.send('Error finding task by id.');
            return;
        }

        taskArray.forEach(function(task, index){
            if (task.id === id) {
                //TODO: kill child-process
            }
        });
    });
});

app.use('/', router);
app.listen(port);

// If the main process ends, close the Mongoose connection
var db_server  = process.env.DB_ENV || 'primary';
var gracefulExit = function() {
    mongoose.connection.close(function () {
        console.log('Mongoose default connection with DB :' + db_server + ' is disconnected through app termination');
        process.exit(0);
    });
};
process.on('SIGINT', gracefulExit).on('SIGTERM', gracefulExit);
