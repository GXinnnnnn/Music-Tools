'use strict';
// Optional local-only fixture tooling; never shipped in source or runtime archives.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const {spawnSync}=require('node:child_process');
async function main(){
 const root=path.resolve(__dirname,'..'),dest=path.join(root,'tests/core-tools');
 if(fs.existsSync(path.join(dest,'imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'))){console.log('Local fixture tools already present.');return;}
 if(process.platform!=='win32'||process.arch!=='x64')throw Error('This fixture bootstrap supports Windows x64 only.');
 const meta=await fetch('https://pypi.org/pypi/imageio-ffmpeg/0.7.0/json',{signal:AbortSignal.timeout(60000)});if(!meta.ok)throw Error('PyPI HTTP '+meta.status);
 const info=await meta.json(),wheel=info.urls.find(x=>x.filename==='imageio_ffmpeg-0.7.0-py3-none-win_amd64.whl');if(!wheel)throw Error('Pinned Windows wheel missing');
 const response=await fetch(wheel.url,{signal:AbortSignal.timeout(300000)});if(!response.ok)throw Error('Wheel HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(crypto.createHash('sha256').update(bytes).digest('hex')!=='7a22b45f60321d4172bdf2bc61f716bce4c81b85727bd59c7c7e371055a6a440')throw Error('Fixture wheel SHA-256 mismatch');
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'music-tools-fixture-download-')),archive=path.join(temporary,'fixtures.whl');fs.writeFileSync(archive,bytes);fs.mkdirSync(dest,{recursive:true});
 const python=path.join(root,'source/vendor/python/python.exe');const result=spawnSync(python,['-X','utf8','-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,dest],{stdio:'inherit',windowsHide:true});
 if(result.error)throw result.error;if(result.status!==0)throw Error('Fixture extraction failed');fs.unlinkSync(archive);fs.rmdirSync(temporary);
 console.log('Downloaded imageio-ffmpeg 0.7.0 for local tests; SHA-256 '+wheel.digests.sha256);console.log('FFmpeg binary has its own GPLv3-enabled build terms; do not add tests/core-tools to releases.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
