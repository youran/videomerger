var wget = require('wget-improved');

// retrieve arguments from parent process
var myArgs = process.argv.slice(2);
var url = myArgs[0];
var path = './tasks/' + myArgs[1] + '-' + myArgs[2] + '.tmp';
var options = {
};

var download = wget.download(url, path, options);
download.on('error', function(err) {
	console.log('wget error: ' + err);
    process.send({error : true});
    process.exit();
});
download.on('start', function(fileSize) {
    console.log('wget started, path= ' + path + ', size= ' + fileSize);
});
download.on('end', function(output) {
    console.log('downloaded to ' + path);
    process.send({complete : true});
    process.exit();
});
download.on('progress', function(progress) {
    //console.log(progress);
	//TODO: report progress in a graceful way
});

process.on('terminate', function() {
	console.log('TERM SIG received');
    process.exit();
});