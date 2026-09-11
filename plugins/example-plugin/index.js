export default {
 id:'example-plugin',name:'Audit extension',version:'1.0.0',
 hooks:[{event:'vm.beforeStart',async handler(data,config){if(config?.blockedVMs?.includes(data.vmId))throw new Error('VM blocked by operational policy');}}],
 settings:[{key:'blockedVMs',type:'string',label:'Blocked VM IDs',default:[]}]
};
