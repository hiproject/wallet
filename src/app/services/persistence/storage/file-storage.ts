import { Injectable } from '@angular/core';
import { DirectoryEntry, File, FileSystem } from '@ionic-native/file/ngx';
import * as _ from 'lodash';
import { Logger } from '../../logger/logger';
import { IStorage, KeyAlreadyExistsError } from './istorage';
// import * as FileReader from 'cordova-plugin-file/www/FileReader';

// ionic integrations enable cordova --quiet
@Injectable({
    providedIn: 'root'
})
export class FileStorage implements IStorage {
  fs: FileSystem;
  dir: DirectoryEntry;

  constructor(private file: File, private log: Logger) {
  }

  async init() {
    return await new Promise((resolve, reject) => {
      if (this.fs && this.dir) return resolve();

      let onSuccess = (fs: FileSystem): Promise<any> => {
        this.log.debug('File system started: ', fs.name, fs.root.name);
        this.fs = fs;
        return this.getDir().then(dir => {
          if (!dir.nativeURL) return reject();
          this.dir = dir;
          this.log.debug('Got main dir:', dir.nativeURL);
          return resolve();
        });
      };

      let onFailure = (err: Error): Promise<any> => {
        this.log.error('Could not init file system: ' + err.message);
        return Promise.reject(err);
      };

      (window as any).requestFileSystem(1, 0, onSuccess, onFailure);
    });
  }

  // See https://github.com/apache/cordova-plugin-file/#where-to-store-files
  getDir(): Promise<DirectoryEntry> {
    if (!this.file) {
      return Promise.reject(new Error('Could not write on device storage'));
    }

    let url = this.file.dataDirectory;
    return this.file.resolveDirectoryUrl(url).catch(err => {
      let msg = 'Could not resolve filesystem ' + url;
      this.log.warn(msg, err);
      throw err || new Error(msg);
    });
  }

  parseResult(v) {
    if (!v) return null;
    if (!_.isString(v)) return v;
    let parsed;
    try {
      parsed = JSON.parse(v);
    } catch (e) {
      // TODO parse is not necessary
    }
    return parsed || v;
  }

  async readFileEntry(fileEntry) {
    return await new Promise((resolve, reject) => {
        fileEntry.file(file => {
            // 在polyfills.ts 已经做好全局兼容处理了
            // reader = reader['__zone_symbol__originalInstance'];
            let reader = new FileReader();

            reader.onerror = () => {
              reader.abort();
              return reject();
            };

            reader.onloadend = () => {
                return resolve(this.parseResult(reader.result));
            };

            reader.readAsText(file);
      });
    });
  }

  async get(k: string) {
    return await new Promise(resolve => {
      this.init()
        .then(() => {
          this.file
            .getFile(this.dir, k, { create: false })
            .then(fileEntry => {
              if (!fileEntry) return resolve();

              this.readFileEntry(fileEntry)
                .then(result => {
                  return resolve(result);
                })
                .catch((err) => {
                  this.log.error('Problem parsing input file.');
                });
            })
            .catch(err => {
              this.log.error(`get [${k}] storage error: `, err);
              // Not found
              if (err.code == 1) return resolve();
              else throw err;
            });
        })
        .catch(err => {
          this.log.error(err);
        });
    });
  }

  set(k: string, v): Promise<void> {
    return Promise.resolve(
      this.init().then(() => {
        this.file.getFile(this.dir, k, { create: true }).then(fileEntry => {
          // Create a FileWriter object for our FileEntry (log.txt).
          return new Promise((resolve, reject) => {
            fileEntry.createWriter(fileWriter => {
              fileWriter.onwriteend = () => {
                return resolve();
              };

              fileWriter.onerror = () => {
                return reject();
              };

              if (_.isObject(v)) v = JSON.stringify(v);
              if (!_.isString(v)) v = v.toString();
              fileWriter.write(v);
            });
          });
        });
      })
    );
  }

  remove(k: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.file
        .removeFile(this.dir.nativeURL, k)
        .then(() => {
          this.log.debug(`Storage Key: ${k} removed`);
          resolve();
        })
        .catch(e => {
          this.log.error('Error removing file: ' + k, e);
          reject(e);
        });
    });
  }

  create(k: string, v): Promise<void> {
    return this.get(k).then(data => {
      if (data) throw new KeyAlreadyExistsError();
      this.set(k, v);
    });
  }
}
