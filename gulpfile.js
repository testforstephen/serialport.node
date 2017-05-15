require('shelljs/global');
const gulp = require('gulp');
const fs = require('fs');
const path = require('path');
const async = require('async');
const cliArgs = require('yargs').argv;
const linuxDistro = require('linux-distro');
const github = require('octonode');
const git = require('simple-git')();

function getRepoName(gitUrl) {
    const fields = gitUrl.split(':');
    if (fields.length < 2) return '';
    const segments = fields[1].split('/');
    const userName = segments[segments.length-2];
    const repoName = segments[segments.length-1];
    const fullRepoName = `${userName}/${repoName}`;
    const position = fullRepoName.length - '.git'.length;
    const lastIndex = fullRepoName.lastIndexOf('.git');
    if (lastIndex !== -1 && lastIndex === position) {
        return fullRepoName.substring(0, position);
    } else {
        return fullRepoName;
    }
}

function uploadAssets(client, tagName, filePath, distName, callback) {
    async.waterfall([
        // parse repo name from git repository configuration
        (callback) => {
            git.listRemote(['--get-url'], function(err, data) {
                if (!err) {
                    console.log('Remote url for repository at ' + __dirname + ':');
                    const repoName = getRepoName(data.trim());
                    console.log(repoName);
                    if (repoName) {
                        callback(null, repoName);
                    } else {
                        callback('Cannot get repo name for this repository.');
                    }
                } else {
                    callback(err);
                }
            });
        },
        // get release by tag
        (repoName, callback) => {
            client.get(`/repos/${repoName}/releases/tags/${tagName}`, (err, res, body) => {
                if (!err) {
                    console.log(`release id: ${body.id}`);
                    callback(null, repoName, body.id);
                } else {
                    callback(`The release via tag ${tagName} not found!`);
                }
            });
        },
        // check if asset exist or not.
        (repoName, releaseId, callback) => {
            client.get(`/repos/${repoName}/releases/${releaseId}/assets`, (err, res, body) => {
                if (!err) {
                    const find = body.find((element) => {
                        return element.name === distName;
                    });
                    if (find) {
                        console.log(`Finded an existing asset '${distName} in github release and delete it first.`);
                        client.del(`/repos/${repoName}/releases/assets/${find.id}`, null, (err1, res1, body1) => {
                            if (err1) {
                                callback(`Cannot delete assets '${distName}'. See the error '${err1}'`);
                            } else {
                                callback(null, repoName, releaseId);
                            }
                        });
                    } else {
                        callback(null, repoName, releaseId);
                    }
                } else {
                    callback(null, repoName, releaseId, null);
                }
            });
        },
        // upload assets to releases.
        (repoName, releaseId, callback) => {
            const ghRelease = client.release(repoName, releaseId);
            const archive = fs.readFileSync(filePath);
            ghRelease.uploadAssets(archive, {
                name: distName,
                contentType: 'application/octet-stream',
                uploadHost: 'uploads.github.com',
            }, (err, res, body) => {
                if (!err) {
                    console.log(`Succeeded to upload assets '${distName}' to github release '${tagName}'`);
                }
                callback(err);
            });
        }
    ], (error, results) => {
        callback(error);
    });
}

gulp.task('buildDll', (done) => {
    if (!cliArgs.repoUrl || !cliArgs.token || !cliArgs.tag) {
        done('Missing repoUrl, token, tag parameters!');
        return ;
    }
    const client = github.client(cliArgs.token);
    const tagName = cliArgs.tag;

    async.waterfall([
        // Pulling package source code from GITHUB.
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
            const gitClone = exec(`git clone -b andy_native_1 ${decodeURIComponent(cliArgs.repoUrl)} usb-native`, {
                cwd: tmpDir
            });
            if (gitClone.code) {
                callback('Pulling node package failed.');
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
                    // Compile node-usb-native native code.
                    tasks.push((callback) => {
                        console.log(`[node-gyp] Starting to build node-usb-usb binary version for electron ${electron} and arch ${arch}.`);
                        const compile = exec(`node-gyp rebuild --target=${electron} --arch=${arch} --dist-url=https://atom.io/download/electron`, {
                            cwd: path.normalize('./tmp/usb-native/vendor/node-usb-native')
                        });
                        if (compile.code) {
                            callback('[node-gyp] Compiling node-usb-native native code failed.');
                        } else {
                            console.log('[node-gyp] Build complete.');
                            console.log(`Generate dll at ${path.normalize('./tmp/usb-native/vendor/node-usb-native/build/Release/usb-native.node')}`);
                            if (platform === 'linux') {
                                linuxDistro().then(data => {
                                    const packageName = `usb-native_${data.os}${data.release || data.code}_${electron}_${arch}.node`;
                                    console.log(packageName);
                                    uploadAssets(client, tagName, path.normalize('./tmp/usb-native/vendor/node-usb-native/build/Release/usb-native.node'), packageName, callback);
                                }, () => {
                                    const packageName = `usb-native_${platform}_${electron}_${arch}.node`;
                                    console.log(packageName);
                                    uploadAssets(client, tagName, path.normalize('./tmp/usb-native/vendor/node-usb-native/build/Release/usb-native.node'), packageName, callback);
                                });
                            } else {
                                const packageName = `usb-native_${platform}_${electron}_${arch}.node`;
                                console.log(packageName);
                                uploadAssets(client, tagName, path.normalize('./tmp/usb-native/vendor/node-usb-native/build/Release/usb-native.node'), packageName, callback);
                            }
                        }
                    });
                });
            });
            async.series(tasks, callback);
        },
    ], (error, result) => {
        done(error);
    });
});
