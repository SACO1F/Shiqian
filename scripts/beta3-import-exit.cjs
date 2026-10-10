const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
  const b=await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const p=b.contexts()[0].pages().find(p=>!p.url().includes("floating"));
    const api=(action,payload={})=>p.evaluate(({action,payload})=>window.__TAURI_INTERNALS__.invoke("api",{action,payload}),{action,payload});
    const boot=await api("bootstrap");
    const qa=path.join(path.resolve(__dirname,".."),"qa","beta3-release");
    assert.equal(path.resolve(boot.dataPath),path.join(qa,"library"));
    assert.equal(boot.version,"0.3.0-beta.3");
    const folder=path.join(qa,"import-stop");fs.mkdirSync(folder,{recursive:true});
    for(let i=0;i<1000;i++) fs.writeFileSync(path.join(folder,`${i}.txt`),`synthetic cancellation ${i}`);
    await api("import",{paths:[folder]});
    await assert.rejects(api("main.close"),/IMPORT_BUSY/);
    await api("import.cancel");
    let job;
    for(let i=0;i<400;i++) {job=await api("import.status");if(job.done)break;await p.waitForTimeout(25);}
    assert.equal(job.done,true);assert.equal(job.cancelled,true);
    assert.equal(fs.readdirSync(folder).length,1000);
    assert.ok((await api("bootstrap")).counts.all>=boot.counts.all);
    console.log(`PASS import close gate, cooperative cancellation completed; ${job.added} committed files retained; all 1000 original synthetic files preserved`);
  } finally {await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
