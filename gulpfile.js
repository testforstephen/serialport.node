require('shelljs/global');
const gulp = require('gulp');
const fs = require('fs');
const path = require('path');
const async = require('async');
const cliArgs = require('yargs').argv;

gulp.task('buildDll', (done) => {
    async.waterfall([
        // Pulling serial port package source code from GITHUB.
        (callback) => {
            const tmpDir = path.normalize('./tmp');
            if (fs.existsSync(tmpDir)) {
                if (process.platform === 'win32') {
                    rm('-rf', tmpDir);
                } else {
                    exec(`sudo rm -rf ${tmpDir}`);
                }
            }
            mkdir('-p', tmpDir);
            const gitClone = exec(`git clone ${decodeURIComponent(cliArgs.repoUrl)} serialport`, {
                cwd: tmpDir
            });
            if (gitClone.code) {
                callback('Pulling serial port node package failed.');
            } else {
                callback();
            }
        },
        // Using node-gyp to compile CPP source code.
        (callback) => {
            const platform = require('os').platform();
            const platformConfig = JSON.parse(fs.readFileSync(path.normalize('./platform.json')));
            const versions = platformConfig[platform];
            const electrons = (cliArgs['electronVersion'] && cliArgs['electronVersion'].split(',')) || (versions ? versions.electron : ['1.4.6']);
            const archs = (cliArgs['arch'] && cliArgs['arch'].split(',')) || (versions ? versions.arch : ['ia32', "x64"]);
            const tasks = [];
            electrons.forEach((electron) => {
                archs.forEach((arch) => {
                    tasks.push((callback) => {
                        console.log(`[node-gyp] Starting to build the binary version for electron ${electron} and arch ${arch}.`);
                        // if (platform === 'win32') {
                        const compile = exec(`node-gyp rebuild --target=${electron} --arch=${arch} --dist-url=https://atom.io/download/electron`, {
                            cwd: path.normalize('./tmp/serialport/vendor/serialport-native')
                        });
                        if (compile.code) {
                            callback('[node-gyp] Compiling serial port native code failed.');
                        } else {
                            console.log('[node-gyp] Build complete.');
                            console.log(`Generate dll at ${path.normalize('./tmp/serialport/build/Release/serialport.node')}`);
                            callback();
                            // console.log('[azure-blob] Starting to upload build package to azure blob.');
                            // uploadFile(path.normalize('./tmp/serialport/build/Release/serialport.node'), `serialport_${platform}_${electron}_${arch}.node`, callback);
                            // console.log(`[azure-blob] Successfully upload binary file "serialport_${platform}_${electron}_${arch}.node" to azure blob.`);
                        }
                        // }
                        // else {
                        //     const compile = exec(`node-gyp rebuild --target=${electron} --arch=${arch} --dist-url=https://atom.io/download/electron`, {
                        //         cwd: path.normalize('./tmp/serialport/vendor/serialport-native')
                        //     });
                        //     if (compile.code) {
                        //         callback('Compiling serial port native code failed.');
                        //     } else {
                        //         console.log('[node-gyp] Build complete.');
                        //         console.log(`Generate dll at ${path.normalize('./tmp/serialport/build/Release/serialport.node')}`);
                        //         callback();
                        //         // console.log('[azure-blob] Starting to upload build package to azure blob.');
                        //         // uploadFile(path.normalize('./tmp/serialport/build/Release/serialport.node'), `serialport_${platform}_${electron}_${arch}.node`, callback);
                        //         // console.log(`[azure-blob] Successfully upload binary file "serialport_${platform}_${electron}_${arch}.node" to azure blob.`);
                        //     }
                        // }
                    });
                });
            });
            async.series(tasks, callback);
        },
    ], (error, result) => {
        if (error) {
            done(error);
        } else {
            done();
        }
    });
});
