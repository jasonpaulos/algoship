export * from './game';

// import * as algosdk from 'algosdk';

// const token = 'bc6ada9f129706ecdc885cd1000141971b9872193e1ad6caf079597649797f93';
// const server = "http://127.0.0.1";
// const port = 51156;

// export function init(token: string, server: string, port: string) {
    
// }

// const client = new algosdk.Algodv2(token, server, port);

// function isASCII(str: string) {
//     return /^[\x00-\x7F]*$/.test(str);
// }

// function base64format(b64: string) {
//     // buffer = Buffer.from(b64, 'base64');
//     // str = buffer.toString('utf8');
//     // if (isASCII(str)) {
//     //     return str
//     // }
//     return `b64:${b64}`;
// }

// function decodeState(stateArray: any[]) {
//     const state: {[key: string]: string | number} = {};

//     for (const pair of stateArray) {
//         const key = base64format(pair.key);
//         // const key = pair.key;
//         let value;

//         if (pair.value.type == 2) {
//             // value is uint64
//             value = pair.value.uint;
//         } else {
//             // value is byte array
//             value = base64format(pair.value.bytes);
//         }

//         state[key] = value;
//     }

//     return state;
// }

// async function readStateLocal(appId: number, account: string) {
//     const ai = await client.accountInformation(account).do();
//     for (const app of ai['apps-local-state']) {
//         if (app.id == appId) {
//             return decodeState(app['key-value']);
//         }
//     }

//     throw new Error("App ID not found in account");
// }

// async function readStateGlobal(appId: number) {
//     const app = await client.getApplicationByID(appId).do();
//     return decodeState(app.params['global-state']);
// }

// async function start() {
//     const local = await readStateLocal(1, 'WYXTF5UK2A26DWC3BHUHGELHTZ5SRGN2WXCJDPPBWMZRR7G2RWKT5KM2GM');
//     console.log(JSON.stringify(local, null, 2));

//     const global = await readStateGlobal(1);
//     console.log(JSON.stringify(global, null, 2));
// }

// // setInterval(() => {
// //     start();
// // }, 5000);
