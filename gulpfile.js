require('shelljs/global');
const gulp = require('gulp');
const fs = require('fs');
const path = require('path');
const async = require('async');
const cliArgs = require('yargs').argv;
const azure = require('azure-storage');

function getDeployConfig() {
    if (fs.existsSync(path.normalize('./.vscino-deploy.json'))) {
        return JSON.parse(fs.readFileSync(path.normalize('./.vscino-deploy.json')));
    }
    const userprofile = process.env.HOME || process.env.USERPROFILE;
    if (fs.existsSync(path.join(userprofile, '.vscino-deploy.json'))) {
        return JSON.parse(fs.readFileSync(path.join(userprofile, '.vscino-deploy.json')));
    } else {
        throw new Error('vscode-arduino extension deploy config is not found.');
    }
}

function uploadFile(filePath, blobName, callback) {
    const deployConfig = getDeployConfig();
    const blobSvc = azure.createBlobService(deployConfig.azureblobConnectString);
    blobSvc.createContainerIfNotExists('serialport', {publicAccessLevel: 'blob'}, (error, result, response) => {
        if (error) {
            callback(`Create container failed with error "${error}"`);
        } else {
            blobSvc.createBlockBlobFromLocalFile('serialport', blobName, filePath, (error, result, response) => {
                if (error) {
                    callback(`Upload binary file "${filePath}" to azure blob failed.`);
                } else {
                    callback();
                }
            });
        }
    });
}

gulp.task('buildSerialPortLib', (done) => {
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
            const gitClone = exec(`git clone https://github.com/EmergingTechnologyAdvisors/node-serialport.git serialport`, {
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
                        if (platform === 'win32') {
                            const compile = exec(`node-gyp rebuild --target=${electron} --arch=${arch} --dist-url=https://atom.io/download/electron`, {
                                cwd: path.normalize('./tmp/serialport')
                            });
                            if (compile.code) {
                                callback('[node-gyp] Compiling serial port native code failed.');
                            } else {
                                console.log('[node-gyp] Build complete.');
                                console.log('[azure-blob] Starting to upload build package to azure blob.');
                                uploadFile(path.normalize('./tmp/serialport/build/Release/serialport.node'), `serialport_${platform}_${electron}_${arch}.node`, callback);
                                console.log(`[azure-blob] Successfully upload binary file "serialport_${platform}_${electron}_${arch}.node" to azure blob.`);
                            }
                        } else {
                            const compile = exec(`sudo node-gyp rebuild --target=${electron} --arch=${arch} --dist-url=https://atom.io/download/electron`, {
                                cwd: path.normalize('./tmp/serialport')
                            });
                            if (compile.code) {
                                callback('Compiling serial port native code failed.');
                            } else {
                                console.log('[node-gyp] Build complete.');
                                console.log('[azure-blob] Starting to upload build package to azure blob.');
                                uploadFile(path.normalize('./tmp/serialport/build/Release/serialport.node'), `serialport_${platform}_${electron}_${arch}.node`, callback);
                                console.log(`[azure-blob] Successfully upload binary file "serialport_${platform}_${electron}_${arch}.node" to azure blob.`);
                            }
                        }
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

gulp.task('downloadSerialPortLib', (done) => {
    const deployConfig = getDeployConfig();
    const blobSvc = azure.createBlobService(deployConfig.azureblobConnectString);
    blobSvc.listBlobsSegmented('serialport', null, (error, result, response) => {
        if (error) {
            done(`Failed to list remote azure blobs with error "${error}"`);
        } else {
            if (!fs.existsSync(path.normalize('./serialport'))) {
                mkdir(path.normalize('./serialport'));
            }
            const downloadTasks = [];
            result.entries.forEach((blobResult) => {
                downloadTasks.push((callback) => {
                    console.log(`Starting to download ${blobResult.name}`);
                    blobSvc.getBlobToLocalFile('serialport', blobResult.name, path.normalize(`./serialport/${blobResult.name}`), (error, result, response) => {
                        if (error) {
                            callback(`Failed to download ${blobResult.name}`);
                        } else {
                            console.log(`Download ${blobResult.name} finished.`);
                            callback();
                        }
                    });
                });
            });
            async.series(downloadTasks, done);
        }
    });
});
