import 'dotenv/config';

import * as grpc from '@grpc/grpc-js';
import * as messages from './proto/schema_pb';
import * as services from './proto/schema_grpc_pb';
import * as empty from 'google-protobuf/google/protobuf/empty_pb';

import { Config } from './interfaces';
import Util from './util';
import Proofs from './proofs';
import Root from './root';
import * as types from './interfaces';
import { getLogger } from '@grpc/grpc-js/build/src/logging';

class ImmudbClient {
    public util = new Util();
    public proofs = new Proofs();
    public root = new Root();
    public client: any;
    private static instance: ImmudbClient;
    private _auth: any;
    private _token: any;
    private _metadata: any;
    private _activeDatabase: any;
    private _serverUUID: any;
    private _serverVersion: any;

    private constructor(
        config: Config
    ) {
        const { host, port, certs, rootPath } = config;

            this._auth = grpc.credentials.createInsecure();

        if (certs) {
            this._auth = grpc.credentials.createSsl();
        }

        this.client = new services.ImmuServiceClient(`${host}:${port}`, this._auth);
        this._metadata = new grpc.Metadata();
        
        if (rootPath) {
            this.root && this.root.setRootPath({
                path: rootPath
            });
        }

        this.health();
    }

    public static getInstance(
        config: Config
    ): ImmudbClient {
        if (!ImmudbClient.instance) {
            console.log('ImmudbClient: creating new instance');
            ImmudbClient.instance = new ImmudbClient(config);
        } else {
            console.log('ImmudbClient: using already available instance');
        }

        const { authorization } = ImmudbClient.instance._metadata;
        if (authorization) {
            console.log('token', authorization.token);
        } else {
            console.log('token unavailable');
        }

        return ImmudbClient.instance;
    }

    async shutdown() {
        this.root && this.root.commit();
        process.exit(0);
    }

    async login (
        params: messages.LoginRequest.AsObject
    ): Promise<messages.LoginResponse.AsObject | undefined> {
        try {
            const { user, password } = params;

            const req = new messages.LoginRequest();
            req.setUser(this.util.utf8Encode(user));
            req.setPassword(this.util.utf8Encode(password));
            
            return new Promise((resolve, reject) => this.client.login(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Login Error', err);
                    return reject(err);
                }

                this._token = res && res.getToken();
                this._metadata && this._metadata.remove('authorization');
                this._metadata && this._metadata.add('authorization', 'Bearer ' + this._token);

                resolve({
                    token: this._token,
                    warning: this.util.utf8Decode(res && res.getWarning())
                });
            }));
        } catch (err) {
            console.error('Login Error', err);
        }
    }

    async createDatabase (
        params: messages.Database.AsObject
    ): Promise<empty.Empty | undefined> {
        try {
            const req = new messages.Database();
            req.setDatabasename(params && params.databasename);
            
            return new Promise((resolve, reject) => this.client.createDatabase(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Create database error');
                    return reject(err);
                }

                resolve();
            }));

        } catch (err) {
            console.error('Create database error', err);
        }
    }

    async useDatabase (
        params: messages.Database.AsObject
    ): Promise<messages.UseDatabaseReply.AsObject | undefined> {
        try {  
            const req = new messages.Database();
            req.setDatabasename(params && params.databasename);

            return new Promise((resolve, reject) => this.client.useDatabase(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Use database error', err);
                    return reject(err);
                }
                
                const token = res && res.getToken();
                this._metadata && this._metadata.remove('authorization');
                this._metadata && this._metadata.add('authorization', 'Bearer ' + token);
                this._activeDatabase = params && params.databasename;
                
                this.currentRoot()
                    .then(() => ({ token }))
                    .catch((err) => { throw new Error('Use database error') });

                resolve();
            }));
        } catch (err) {
            console.error('Use database error', err);
        }
    }

    async set (
        params: messages.KeyValue.AsObject
    ): Promise<messages.Index.AsObject | undefined> {
        try {
            const req = new messages.KeyValue();
            req.setKey(this.util && this.util.utf8Encode(params && params.key));
            req.setValue(this.util && this.util.utf8Encode(params && params.value));

            return new Promise((resolve, reject) => this.client.set(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Set error', err);
                    return reject(err);
                }

                resolve({
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error('Set error', err);
        }  
    }

    async get (
        params: messages.Key.AsObject
    ): Promise<messages.Item.AsObject | undefined> {
        try {
            const req = new messages.Key();
            req.setKey(this.util && this.util.utf8Encode(params && params.key));

            return new Promise((resolve, reject) => this.client.get(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Get error', err);
                    throw new Error(err);
                }

                resolve({
                    key: this.util && this.util.utf8Decode(res && res.getKey()),
                    value: this.util && this.util.utf8Decode(res && res.getValue()),
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async listDatabases (): Promise <messages.DatabaseListResponse.AsObject | undefined> {
        try {
            const req = new empty.Empty();

            return new Promise((resolve, reject) => this.client.databaseList(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('List databases error', err);
                    return reject(err);
                }

                const dl = res && res.getDatabasesList();
                const l = [];
                for (let i = 0; dl && i < dl.length; i++) {
                    l.push(dl[i].getDatabasename());
                }

                resolve({
                    databasesList: l
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async changePermission (
        params: messages.ChangePermissionRequest.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.ChangePermissionRequest();
            req.setAction(params && params.action);
            req.setPermission(params && params.permission);
            req.setUsername(params && params.username);
            req.setDatabase(params && params.database);

            return new Promise((resolve, reject) => this.client.changePermission(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Change permission error', err);
                    return reject(err);
                }

                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async listUsers (): Promise <messages.UserList.AsObject | undefined> {
        try {
            const req = new empty.Empty();

            return new Promise((resolve, reject) => this.client.listUsers(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('List users error', err);
                    throw new Error(err);
                }

                const ul = res && res.getUsersList();
                const l = [];
                for (let i = 0; ul && i < ul.length; i++) {
                    let u = ul[i];

                    const pl = u.getPermissionsList();
                    const p = [];
                    for (let j = 0; j < pl.length; j++) {
                        p.push({
                            database: pl[j].getDatabase(),
                            permission: pl[j].getPermission()
                        });
                    }

                    l.push({
                        user: this.util && this.util.utf8Decode(u.getUser()),
                        permissionsList: p,
                        createdby: u.getCreatedby(),
                        createdat: u.getCreatedat(),
                        active: u.getActive()
                    });
                }

                resolve({
                    usersList: l
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async createUser (
        params: messages.CreateUserRequest.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.CreateUserRequest();
            req.setUser(this.util && this.util.utf8Encode(params && params.user));
            req.setPassword(this.util && this.util.utf8Encode(params && params.password));
            req.setPermission(params && params.permission);
            req.setDatabase(params && params.database);

            return new Promise((resolve, reject) => this.client.createUser(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Create user error', err);
                    return reject(err);
                }

                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async changePassword (
        params: messages.ChangePasswordRequest.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.ChangePasswordRequest();
            req.setUser(this.util && this.util.utf8Encode(params && params.user));
            req.setOldpassword(this.util && this.util.utf8Encode(params && params.oldpassword));
            req.setNewpassword(this.util && this.util.utf8Encode(params && params.newpassword));

            return new Promise((resolve, reject) => this.client.changePassword(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Change password error', err);
                    return reject(err);
                }

                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async logout (): Promise <empty.Empty | undefined> {
        try {
            const req = new empty.Empty();

            return new Promise((resolve, reject) => this.client.logout(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Logout error', err);
                    throw new Error(err);
                }

                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async setActiveUser (
        params: messages.SetActiveUserRequest.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.SetActiveUserRequest();
            req.setUsername(params && params.username);
            req.setActive(params && params.active);

            return new Promise((resolve, reject) => this.client.setActiveUser(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Set active user error', err);
                    return reject(err);
                }

                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    // async printTree (): Promise <messages.Tree.AsObject | undefined> {
    //     try {
    //         const req = new empty.Empty();

    //         return new Promise((resolve, reject) => this.client.printTree(req, this._metadata, (err: any, res: any) => {
    //             if (err) {
    //                 console.error('Print tree error', err);
    //                 return reject(err);
    //             }

    //             // const tList = [];
    //             const tList = new messages.Tree();
    //             const tl = res && res.getTList();
    //             for (let i = 0; tl && i < tl.length; i++) {
    //                 let layer = tl[i];

    //                 const ll = layer.getLList();
    //                 const lList = new messages.Layer();
    //                 for (let j = 0; j < ll.length; j++) {
    //                     let node = new messages.Node(ll[j]);
    //                     node.setI();
    //                     node.setH();
    //                     node.setRefk();
    //                     node.setRef();
    //                     node.setCache();
    //                     node.setRoot();

    //                     let refk = node.getRefk() == ''
    //                         ? node.getRefk() :
    //                         this.util && this.util.utf8Decode(node.getRefk());

    //                     lList.addL(<messages.Node.AsObject>{
    //                         i: this.util && this.util.base64Encode(node.getI()),
    //                         h: this.util && this.util.base64Encode(node.getH()),
    //                         refk: refk,
    //                         ref: node.getRef(),
    //                         cache: node.getCache(),
    //                         root: node.getRoot()
    //                     });
    //                 }

    //                 tList.addT(lList);
    //             }

    //             resolve({
    //                 tList: tList
    //             });
    //         }));
    //     } catch (err) {
    //         console.error(err);
    //     }
    // }

    async health (): Promise <messages.HealthResponse.AsObject | undefined> {
        try {
            const req = new empty.Empty();

            return new Promise((resolve, reject) => this.client.health(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Health error', err);
                    return reject(err);
                }

                this._serverVersion = res && res.getVersion().split(' ')[1];
                
                resolve({
                    status: res && res.getStatus(),
                    version: res && res.getVersion()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async count (
        params: messages.KeyPrefix.AsObject
    ): Promise <messages.ItemsCount.AsObject | undefined> {
        try {
            const req = new messages.KeyPrefix();
            req.setPrefix(this.util && this.util.utf8Encode(params && params.prefix));

            return new Promise((resolve, reject) => this.client.count(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Count error', err);
                    return reject(err);
                }

                resolve({
                    count: res && res.getCount()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async scan (
        params: messages.ScanOptions.AsObject
    ): Promise <messages.ItemList.AsObject | undefined> {
        try {
        const req = new messages.ScanOptions();
            req.setPrefix(this.util && this.util.utf8Encode(params && params.prefix));
            req.setOffset(this.util && this.util.utf8Encode(params && params.offset));
            req.setLimit(params && params.limit);
            req.setReverse(params && params.reverse);
            req.setDeep(params && params.deep);

            return new Promise((resolve, reject) => this.client.scan(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Scan error', err);
                    return reject(err);
                }

                const result = [];
                const il = res && res.getItemsList();
                for (let i = 0; il && i < il.length; i++) {
                    let item = il[i];
                    result.push({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                }

                resolve({
                    itemsList: result
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async byIndex (
        params: messages.Index.AsObject
    ): Promise <messages.Item.AsObject | undefined> {
        try {
            const req = new messages.Index();
            req.setIndex(params && params.index);

            return new Promise((resolve, reject) => this.client.byIndex(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('By index error', err);
                    return reject(err);
                }

                resolve({
                    key: this.util && this.util.utf8Decode(res && res.getKey()),
                    value: this.util && this.util.utf8Decode(res && res.getValue()),
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async history (
        params: messages.HistoryOptions.AsObject
    ): Promise <messages.ItemList.AsObject | undefined> {
        try {
            const req = new messages.HistoryOptions();
            req.setKey(this.util && this.util.utf8Encode(params && params.key));
            req.setOffset(params && params.offset);
            req.setLimit(params && params.limit);
            req.setReverse(params && params.reverse);

            return new Promise((resolve, reject) => this.client.history(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('History error', err);
                    return reject(err);
                }

                const result = [];
                const il = res && res.getItemsList();
                for (let i = 0; il && i < il.length; i++) {
                    let item = il[i]
                    result.push({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                }


                resolve({
                    itemsList: result
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async zScan (
        params: messages.ZScanOptions.AsObject
    ): Promise <messages.ItemList.AsObject | undefined> {
        try {
            const req = new messages.ZScanOptions();
            req.setSet(this.util && this.util.utf8Encode(params && params.set));
            req.setOffset(this.util && this.util.utf8Encode(params && params.offset));
            req.setLimit(params && params.limit);
            req.setReverse(params && params.reverse);

            return new Promise((resolve, reject) => this.client.zScan(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('zScan error', err);
                    return reject(err);
                }

                const result = []
                const il = res && res.getItemsList()
                for (let i = 0; il && i < il.length; i++) {
                    let item = il[i];
                    result.push({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                }

                resolve({
                    itemsList: result
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async iScan (
        params: messages.IScanOptions.AsObject
    ): Promise <messages.Page.AsObject | undefined> {
        try {
            const req = new messages.IScanOptions();
            req.setPagesize(params && params.pagesize);
            req.setPagenumber(params && params.pagenumber);

            return new Promise((resolve, reject) => this.client.iScan(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('iScan error', err);
                    return reject(err);
                }

                const result = []
                const il = res && res.getItemsList()
                for (let i = 0; il && i < il.length; i++) {
                    let item = il[i];
                    result.push({
                        key: this.util && this.util.utf8Decode(item && item.getKey()),
                        value: this.util && this.util.utf8Decode(item && item.getValue()),
                        index: item && item.getIndex()
                    });
                }

                resolve({
                    itemsList: result,
                    more: res && res.getMore()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async currentRoot (): Promise <messages.Root.AsObject | undefined> {
        try {
            const req = new empty.Empty();

            return new Promise((resolve, reject) => this.client.currentRoot(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Current root error', err);
                    return reject(err);
                }

                let payload = res && res.getPayload();
                let signature = res && res.getSignature();

                this.root && this.root.set({
                    server: this._serverUUID,
                    database: this._activeDatabase,
                    root: payload && payload.getRoot(),
                    index: payload && payload.getIndex()
                });

                resolve({
                    payload: {
                        index: payload && payload.getIndex(),
                        root: payload && payload.getRoot()
                    },
                    signature: {
                        signature: signature && signature.getSignature(),
                        publickey: signature && signature.getPublickey()
                    }
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async zAdd (
        params: types.SimpleZAddOptions.AsObject
    ): Promise <messages.Index.AsObject | undefined> {
        try {
            const req = new messages.ZAddOptions();
            const score = new messages.Score();
            const index = new messages.Index();
            params && score.setScore(params.score || 0);
            params && index.setIndex(params.index || 0);
            req.setSet(this.util && this.util.utf8Encode(params && params.set));
            req.setScore(score);
            req.setIndex(index);
            req.setKey(this.util && this.util.utf8Encode(params && params.key));

            return new Promise((resolve, reject) => this.client.zAdd(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('zAdd error', err);
                    return reject(err);
                }

                resolve({
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async reference (
        params: messages.ReferenceOptions.AsObject
    ): Promise <messages.Index.AsObject | undefined> {
        try {
            const req = new messages.ReferenceOptions();
            req.setReference(this.util && this.util.utf8Encode(params && params.reference));
            req.setKey(this.util && this.util.utf8Encode(params && params.key));

            return new Promise((resolve, reject) => this.client.reference(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Reference error', err);
                    return reject(err);
                };

                resolve({
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async setBatch (
        params: messages.KVList.AsObject
    ): Promise <messages.Index.AsObject | undefined> {
        try {
            const req = new messages.KVList();

            for (let i = 0; params && params.kvsList && i < params.kvsList.length; i++) {
                const kv = new messages.KeyValue() ;
                kv.setKey(this.util && this.util.utf8Encode(params && params.kvsList[i].key));
                kv.setValue(this.util && this.util.utf8Encode(params && params.kvsList[i].value));
                req.addKvs(kv);
            }

            return new Promise((resolve, reject) => this.client.setBatch(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Set batch error', err);
                    return reject(err);
                }

                resolve({
                    index: res && res.getIndex()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async getBatch (
        params: messages.KeyList.AsObject
    ): Promise <messages.ItemList.AsObject | undefined> {
        try {
            const l = [];
            for (let i = 0; params && params.keysList && i < params.keysList.length; i++) {
                const key = new messages.Key();
                key.setKey(this.util && this.util.utf8Encode(params && params.keysList[i].key));
                l.push(key);
            }

            const req = new messages.KeyList();
            req.setKeysList(l);

            return new Promise((resolve, reject) => this.client.getBatch(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Get batch error', err);
                    return reject(err);
                }

                const result = [];
                const il = res && res.getItemsList();
                for (let i = 0; il && i < il.length; i++) {
                    let item = il[i]
                    result.push({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                }

                resolve({
                    itemsList: result
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async safeSet (
        params: messages.KeyValue.AsObject
    ): Promise <messages.Index.AsObject | undefined> {
        try {
            const kv = new messages.KeyValue();
            kv.setKey(this.util && this.util.utf8Encode(params && params.key));
            kv.setValue(this.util && this.util.utf8Encode(params && params.value));

            const index = new messages.Index();
            index.setIndex(this.util && this.root.get({
                server: this._serverUUID,
                database: this._activeDatabase
            }).index);

            const req = new messages.SafeSetOptions();
            req.setKv(kv);
            req.setRootindex(index);

            return new Promise((resolve, reject) => this.client.safeSet(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('SafeSet error', err);
                    return reject(err);
                }

                const verifyReq = {
                    proof: {
                        inclusionPath: res && res.getInclusionpathList(),
                        consistencyPath: res && res.getConsistencypathList(),
                        index: res && res.getIndex(),
                        at: res && res.getAt(),
                        leaf: res && res.getLeaf(),
                        root: res && res.getRoot(),
                    },
                    item: {
                        key: this.util && this.util.utf8Encode(params && params.key),
                        value: this.util && this.util.utf8Encode(params && params.value),
                        index: res && res.getIndex(),
                    },
                    oldRoot: this.root && this.root.get({
                        server: this._serverUUID,
                        database: this._activeDatabase
                    })
                };

                this.proofs && this.proofs.verify(verifyReq, (err: any) => {
                    if (err) {
                        return { err };
                    }

                    this.root && this.root.set({
                        server: this._serverUUID,
                        database: this._activeDatabase,
                        root: res && res.getRoot(),
                        index: res && res.getAt()
                    });

                    resolve({
                        index: res && res.getIndex()
                    });
                })
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async safeGet (
        params: messages.Key.AsObject
    ): Promise <messages.Item.AsObject | undefined> {
        try {
            const index = new messages.Index();
            index.setIndex(this.root && this.root.get({
                server: this._serverUUID,
                database: this._activeDatabase
            }).index);

            const req = new messages.SafeGetOptions();
            req.setKey(this.util && this.util.utf8Encode(params && params.key));
            req.setRootindex(index);


            return new Promise((resolve, reject) => this.client.safeGet(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('SafeGet error', err);
                    return reject(err);
                }

                const proof = res && res.getProof();
                const item = res && res.getItem();
                const verifyReq = {
                    proof: {
                        inclusionPath: proof.getInclusionpathList(),
                        consistencyPath: proof.getConsistencypathList(),
                        index: proof.getIndex(),
                        at: proof.getAt(),
                        leaf: proof.getLeaf(),
                        root: proof.getRoot(),
                    },
                    item: {
                        key: item.getKey(),
                        value: item.getValue(),
                        index: item.getIndex(),
                    },
                    oldRoot: this.root && this.root.get({
                        server: this._serverUUID,
                        database: this._activeDatabase,
                    })
                };

                this.proofs && this.proofs.verify(verifyReq, (err: any) => {
                    if (err) {
                        return { err };
                    }

                    this.root && this.root.set({
                        server: this._serverUUID,
                        database: this._activeDatabase,
                        root: proof.getRoot(),
                        index: proof.getAt()
                    });

                    resolve({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                })
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async updateAuthConfig (
        params: messages.AuthConfig.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.AuthConfig();
            req.setKind(params && params.kind);

            return new Promise((resolve, reject) => this.client.updateAuthConfig(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Update auth config error', err);
                    return reject(err);
                }
                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async updateMTLSConfig (
        params: messages.MTLSConfig.AsObject
    ): Promise <empty.Empty | undefined> {
        try {
            const req = new messages.MTLSConfig();
            req.setEnabled(params && params.enabled);

            return new Promise((resolve, reject) => this.client.updateMTLSConfig(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('Update mtls config error', err);
                    return reject(err);
                }
                resolve();
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async safeZAdd (
        params: types.SimpleZAddOptions.AsObject
    ): Promise <messages.Index.AsObject | undefined> {
        try {
            const options = new messages.ZAddOptions();
            const score = new messages.Score();
            params && score.setScore(params.score || 0);
            options.setSet(this.util && this.util.utf8Encode(params && params.set));
            options.setScore(score);
            options.setKey(this.util && this.util.utf8Encode(params && params.key));

            const index = new messages.Index()
            index.setIndex(this.root && this.root.get({
                server: this._serverUUID,
                database: this._activeDatabase
            }).index);

            const req = new messages.SafeZAddOptions();
            req.setZopts(options);
            req.setRootindex(index);

            return new Promise((resolve, reject) => this.client.safeZAdd(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('safeZAdd error', err);
                    return reject(err);
                }

                let key2 = this.proofs && this.proofs.setKey({
                    key: this.util && this.util.utf8Encode(params && params.key),
                    set: this.util && this.util.utf8Encode(params && params.set),
                    score: params && params.score
                });

                const verifyReq = {
                    proof: {
                        inclusionPath: res && res.getInclusionpathList(),
                        consistencyPath: res && res.getConsistencypathList(),
                        index: res && res.getIndex(),
                        at: res && res.getAt(),
                        leaf: res && res.getLeaf(),
                        root: res && res.getRoot()
                    },
                    item: {
                        key: key2,
                        value: this.util && this.util.utf8Encode(params && params.key),
                        index: res && res.getIndex()
                    },
                    oldRoot: this.root && this.root.get({
                        server: this._serverUUID,
                        database: this._activeDatabase
                    })
                };

                this.proofs && this.proofs.verify(verifyReq, (err: any) => {
                    if (err) {
                        return { err };
                    }

                    this.root && this.root.set({
                        server: this._serverUUID,
                        database: this._activeDatabase,
                        root: res && res.getRoot(),
                        index: res && res.getAt()
                    });

                    resolve({
                        index: res && res.getIndex()
                    });
                })
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async inclusion (
        params: messages.Index.AsObject
    ): Promise <messages.InclusionProof.AsObject | undefined> {
        try {
            const req = new messages.Index();
            req.setIndex(params && params.index);

            return new Promise((resolve, reject) => this.client.inclusion(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('inclusion error', err);
                    return reject(err);
                }

                resolve({
                    at: res && res.getAt(),
                    index: res && res.getIndex(),
                    root: res && res.getRoot(),
                    leaf: res && res.getLeaf(),
                    pathList: res && res.getPathList()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async consistency (
        params: messages.Index.AsObject
    ): Promise <messages.ConsistencyProof.AsObject | undefined> {
        try {
            const req = new messages.Index();
            req.setIndex(params && params.index);

            return new Promise((resolve, reject) => this.client.consistency(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('consistency error', err);
                    return reject(err);
                };

                resolve({
                    first: res && res.getFirst(),
                    second: res && res.getSecond(),
                    firstroot: res && res.getFirstroot(),
                    secondroot: res && res.getSecondroot(),
                    pathList: res && res.getPathList()
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }

    async bySafeIndex (
        params: messages.Index.AsObject
    ): Promise <messages.Item.AsObject | undefined> {
        try {
            let oldRoot = this.root && this.root.get({
                server: this._serverUUID,
                database: this._activeDatabase,
            });

            const index = new messages.Index();
            index.setIndex(oldRoot.index);

            const req = new messages.SafeIndexOptions();
            req.setIndex(params && params.index);
            req.setRootindex(index);

            return new Promise((resolve, reject) => this.client.bySafeIndex(req, this._metadata, (err: any, res: any) => {
                if (err) {
                    console.error('bySafeIndex error', err);
                    return reject(err);
                }

                const proof = res && res.getProof();
                const item = res && res.getItem();
                const verifyReq = {
                    proof: {
                        inclusionPath: proof.getInclusionpathList(),
                        consistencyPath: proof.getConsistencypathList(),
                        index: proof.getIndex(),
                        at: proof.getAt(),
                        leaf: proof.getLeaf(),
                        root: proof.getRoot(),
                    },
                    item: {
                        key: item.getKey(),
                        value: item.getValue(),
                        index: item.getIndex()
                    },
                    oldRoot: oldRoot,
                };

                oldRoot = this.root && this.root.get({
                    server: this._serverUUID,
                    database: this._activeDatabase,
                });

                this.proofs && this.proofs.verify(verifyReq, (err: any) => {
                    if (err) {
                        return { err };
                    }

                    this.root && this.root.set({
                        server: this._serverUUID,
                        database: this._activeDatabase,
                        root: proof.getRoot(),
                        index: proof.getAt(),
                    });

                    resolve({
                        key: this.util && this.util.utf8Decode(item.getKey()),
                        value: this.util && this.util.utf8Decode(item.getValue()),
                        index: item.getIndex()
                    });
                });
            }));
        } catch (err) {
            console.error(err);
        }
    }
}

export default ImmudbClient;