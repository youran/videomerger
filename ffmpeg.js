var ffmpeg = require('fluent-ffmpeg');
//var async = require('async');
var fs = require('fs');

var myArgs = process.argv.slice(2);
var taskId = myArgs[0];
var num = myArgs[1];
var curDir = './tasks/' + taskId;
//var tmpDir = './tmpDir';	// temporary working folder for ffmpeg
var resultPath = './tasks/' + taskId + '-merged_video.mp4'; // merged file
var servePath = '/var/www/html/videomerger/' + resultPath.split('/').pop();    // change permissions of target folder if necessary

//generate file list from args
var fileList = [];
for (var i=0; i<num; i++) {
	fileList.push('./tasks/' + taskId + '-' + i + '.tmp');
}

// variables for encoding
var codecs = [];
var probe = ffmpeg(curDir + '-0.tmp');
var bitRate;

var aCodec = 'copy', vCodec = 'copy';
var aacCodec = true, x264Codec = true;
var mp4FormatFlag = true;
var needConvertFlag;
var convertedFlag = false;

var moveFile = function() {
	fs.renameSync(resultPath, servePath);
};

// define a series of asynchronous functions
var doProbe = function(callback) {  // detect codecs
	probe.ffprobe(function(err, data) {
		if (err) {
			console.log('ffprobe err: ' + err);
			process.send({error : true});
			process.exit();
		}
		if (data.streams !== undefined) {
			data.streams.forEach(function(streamdata, index){
				console.log('detected codec: ' + streamdata.codec_name);
				codecs.push(streamdata.codec_name);
			});
		}
		if (data.format !== undefined) {
			console.log('detected format: ' + data.format.format_name);
			if (data.format.format_name.indexOf('mp4') === -1) {
				mp4FormatFlag = false;
			}
			bitRate = (Math.ceil(parseInt(data.format.bit_rate, 10) / 1000)) + 'k';
			console.log('detected bit_rate: ' + bitRate);
		}
	});

	//callback(null, 'doProbe');
};

var doConversion = function(callback) { // if not in H.264 + AAC format, convert before merging
	console.log('into doConversion');
	console.log('codecs=' + codecs + ', bitRate=' + bitRate);
	if (codecs.indexOf('aac') === -1) {
		//TODO: more parameters
		aCodec = 'libfdk_aac';
		aacCodec = false;
	}
	if (codecs.indexOf('h264') === -1) {
		//TODO: more parameters
		vCodec = 'libx264';
		x264Codec = false;
	}
	needConvertFlag = (aacCodec === false) || (x264Codec === false) || (mp4FormatFlag === false);

	// do the conversion if necessary
	if (needConvertFlag === true) {
		var total = fileList.length;
		var finished = 0;
		fileList.forEach(function(entry, index){
			var cmd = ffmpeg(entry);
			cmd.outputOptions('-movflags faststart');

			cmd.videoCodec(vCodec);
			if (x264Codec === false) {
				cmd.videoBitrate(bitRate);	// bit rate approximates to original one
			}

			cmd.audioCodec(aCodec);
			if (aacCodec === false) {
				cmd.audioQuality(5);	// VBR mode 5 for libfdk_aac (96-112kbps per channel)
			}

			cmd.on('error', function(err) {
					console.log('Conversion error occurred: ' + err.message);
					process.send({error : true});
					process.exit();
				})
				.on('end', function() {
					console.log('Conversion finished !');
					finished++;
					if (finished === total) {
						convertedFlag = true;
					}
				});
			console.log('ready to convert. vCodec=' + vCodec + ', aCodec=' + aCodec + ', bitRate=' + bitRate);
			cmd.save(entry + '.mp4');
		});
	} else {
		convertedFlag = true;   // if no need to convert, set convertedFlag to true immediately
	}

	//callback(null, 'doConversion');
};

var doMerge = function(callback) {
	console.log('into doMerge');
	// do the merge
	var merge = ffmpeg();
	var listFileName = "./tasks/" + taskId + '.txt', fileNames = '';

	// ffmpeg -f concat -i mylist.txt -c copy output
	fileList.forEach(function(entry, index){
		fileNames = fileNames + 'file ' + '\'' + entry.slice(8);
		if (needConvertFlag === true && convertedFlag === true) {
			fileNames = fileNames + '.mp4';
		}
		fileNames = fileNames + '\'\n';
	});
	console.log('files to merge:\n' + fileNames);

	fs.writeFileSync(listFileName, fileNames);

	merge.input(listFileName);
	merge.inputOptions(['-f concat', '-safe 0']);
	merge.outputOptions('-c copy');
	merge.on('error', function(err) {
			console.log('Merging error occurred: ' + err.message);
			process.send({error : true});
			process.exit();
		})
		.on('end', function() {
			console.log('Merging finished!');
			moveFile();
			console.log('File moved into position.');
			process.send({complete : true, filePath : resultPath});
			process.exit();
		})
		//.mergeToFile(resultPath, tmpDir);
		.save(resultPath);
	//callback(null, 'doMerge');
};

// execute functions in order
doProbe();
var checkProbeFlag = setInterval(function() {
	if (bitRate !== undefined) {
		clearInterval(checkProbeFlag);
		doConversion();
	}
}, 1000);
var checkConversionFlag = setInterval(function() {
	if (convertedFlag === true) {
		clearInterval(checkConversionFlag);
		doMerge();
	}
}, 1000);

/*async.series([doProbe, doConversion, doMerge],
	function(err, results){
		console.log('ffmpeg async functions completed=' + results);
		if (err) {
			console.log('ffmpeg async functions error: ' + err);
			process.exit();
		}

		console.log('ffmpeg process completed with no error');
	}
);*/
