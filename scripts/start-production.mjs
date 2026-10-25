import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
// One existing Render service, one worker, no additional infrastructure or paid services.
const next=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','0.0.0.0'],{stdio:'inherit',windowsHide:true,env:process.env});
let worker,stopping=false,restart;
function startWorker(){
 if(stopping||process.env.TRANSLATION_ENABLED!=='true')return;
 worker=spawn(process.execPath,[resolve('scripts/translation-worker.mjs')],{stdio:'inherit',windowsHide:true,env:process.env});
 worker.on('exit',code=>{if(!stopping&&code!==78)restart=setTimeout(startWorker,30000)});
}
function stop(){stopping=true;clearTimeout(restart);worker?.kill('SIGTERM');next.kill('SIGTERM');}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
next.on('exit',code=>{stopping=true;clearTimeout(restart);worker?.kill('SIGTERM');process.exitCode=code??1});
startWorker();