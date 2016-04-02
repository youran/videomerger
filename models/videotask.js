var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var videoTask = new Schema({
    taskId: Number,
    downloadComplete: Boolean,
    downloadError: Boolean,
    mergeComplete: Boolean,
    mergeError: Boolean,
    filePath: String
});

module.exports = mongoose.model('videoTask', videoTask);
