const { contextBridge, ipcRenderer } = require('electron');

// Must match CHANNELS in ipc.js (checked by tests/unit/ipc.test.js).
const ALLOWED = [
  'auth:login', 'auth:me', 'auth:logout', 'auth:changePassword',
  'offices:list', 'offices:create', 'offices:update', 'offices:archive', 'offices:restore',
  'employees:list', 'employees:create', 'employees:update', 'employees:archive', 'employees:restore',
  'signatories:list', 'signatories:create', 'signatories:update', 'signatories:archive', 'signatories:restore',
  'signatories:defaults', 'signatories:setDefault',
  'records:create', 'records:issueBlank', 'records:listBlank', 'records:fillBlank', 'records:print', 'records:openExport', 'records:preview',
  'records:list', 'records:get', 'records:update', 'records:archive', 'records:restore',
];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => {
    if (!ALLOWED.includes(channel)) throw new Error(`Channel not allowed: ${channel}`);
    return ipcRenderer.invoke(channel, payload);
  },
});
