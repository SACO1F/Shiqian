const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9223');
 try {
  const ctx=browser.contexts()[0],p=ctx.pages().find(p=>!p.url().includes('floating'));
  p.setDefaultTimeout(12000);
  const errors=[];p.on('pageerror',e=>errors.push(String(e)));
  const invoke=(cmd,args={})=>p.evaluate(({cmd,args})=>window.__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args});
  const api=(action,payload={})=>invoke('api',{action,payload});
  const boot=await api('bootstrap');
  assert.equal(boot.version,'0.3.0-beta.9');
  assert.equal(path.resolve(boot.dataPath),path.resolve(__dirname,'../qa/beta9-ui/library'));
  const property=name=>invoke('plugin:window|'+name,{label:'main'});
  const wait=async(read,expected)=>{for(let i=0;i<80;i++){if(await read()===expected)return;await p.waitForTimeout(50);}throw Error('Native state did not settle');};
  assert.equal(await property('is_decorated'),false);
  assert.equal(await p.locator('.app-topbar').count(),1);
  const rect=await p.locator('.app-topbar').boundingBox();
  assert.equal(rect.y,0);assert.equal(rect.height,32);
  assert.equal(await p.locator('.window-resize').count(),8);
  await p.getByRole('button',{name:'最大化窗口',exact:true}).click();
  await wait(()=>property('is_maximized'),true);
  await p.getByRole('button',{name:'还原窗口',exact:true}).waitFor();
  assert.equal(await p.locator('.window-resize').count(),0);
  await p.getByRole('button',{name:'还原窗口',exact:true}).click();
  await wait(()=>property('is_maximized'),false);
  await p.getByRole('button',{name:'最大化窗口',exact:true}).waitFor();
  assert.equal(await p.locator('.window-resize').count(),8);
  // Dispatch only dblclick to test the handler without starting an OS drag loop.
  await p.locator('.window-drag-region').dispatchEvent('dblclick');
  await wait(()=>property('is_maximized'),true);
  await p.getByRole('button',{name:'还原窗口',exact:true}).click();
  await wait(()=>property('is_maximized'),false);
  await p.getByRole('button',{name:'最小化窗口',exact:true}).click();
  await wait(()=>property('is_minimized'),true);
  await api('main.show');await wait(()=>property('is_minimized'),false);
  console.log('PASS main native decorations disabled; 32px titlebar at y=0; maximize/restore, dblclick handler, minimize/reopen and edge handles visibility');
  await api('floating.open');
  let floating;
  for(let i=0;i<100;i++){floating=ctx.pages().find(p=>!p.isClosed()&&p.url().includes('floating'));if(floating)break;await p.waitForTimeout(50);}
  await floating.getByRole('button',{name:'打开工作台',exact:true}).waitFor();
  await p.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await wait(()=>property('is_visible'),false);
  assert.equal(await floating.getByRole('button',{name:'打开工作台',exact:true}).isVisible(),true);
  await floating.getByRole('button',{name:'打开工作台',exact:true}).click();
  await wait(()=>property('is_visible'),true);
  await api('floating.close');
  for(const theme of ['light','dark']){
    await api('settings.save',{key:'theme',value:theme});await p.reload();
    await p.getByRole('button',{name:'关闭窗口',exact:true}).waitFor();
    await p.screenshot({path:path.resolve(__dirname,'../qa/beta9-ui/titlebar-'+theme+'.png')});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS close button follows existing hide-with-palette path; palette reopens main; light/dark custom titlebar and no page errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
