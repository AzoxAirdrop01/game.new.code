// ui-controller.js - AZOX Menu & Socket Controller
(function(){
'use strict';
const socket = io();
window.gameSocket = socket;

let currentRoom=null,currentMode=null,selectedMap='snow';
let selectedTeam='A',selectedDiff='medium',isHost=false;
let pendingAction=null,pendingCode=null,playerName='';
const TEAMS=['A','B','C','D','E','F','G','H','I','J','K','L'];

const $=id=>document.getElementById(id);
const show=id=>{const e=$(id);if(e)e.classList.remove('hidden')};
const hide=id=>{const e=$(id);if(e)e.classList.add('hidden')};
function showOnly(id){['lobby-menu','mode-selection-menu','room-lobby-menu'].forEach(hide);show(id)}

function buildTeamButtons(){
    const wrap=$('team-buttons');if(!wrap)return;wrap.innerHTML='';
    TEAMS.forEach(t=>{
        const btn=document.createElement('button');
        btn.className='team-btn'+(t===selectedTeam?' active':'');
        btn.textContent=t;btn.dataset.team=t;
        btn.addEventListener('click',()=>{
            selectedTeam=t;
            wrap.querySelectorAll('.team-btn').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
        });
        wrap.appendChild(btn);
    });
}

$('btn-create-room')?.addEventListener('click',()=>{
    playerName=$('input-player-name')?.value.trim()||'Soldier';
    pendingAction='create';pendingCode=null;
    showOnly('mode-selection-menu');buildTeamButtons();
});

$('btn-join-room')?.addEventListener('click',()=>{
    playerName=$('input-player-name')?.value.trim()||'Soldier';
    const code=$('input-room-code')?.value.trim();
    if(!code||code.length!==6){_showError('Enter a valid 6-digit code');return;}
    pendingAction='join';pendingCode=code;
    showOnly('mode-selection-menu');buildTeamButtons();
});

document.querySelectorAll('.map-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
        selectedMap=btn.dataset.map;
        document.querySelectorAll('.map-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
    });
});

document.querySelectorAll('.diff-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
        selectedDiff=btn.dataset.diff;
        document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
    });
});

document.querySelectorAll('.mode-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
        currentMode=btn.dataset.mode;
        const ts=$('team-select'),ds=$('difficulty-select');
        if(ts)ts.classList.toggle('hidden',currentMode!=='TEAM_BATTLE');
        if(ds)ds.classList.toggle('hidden',currentMode!=='VS_COMPUTER');
        if(pendingAction==='create') _createRoom(currentMode);
        else _joinRoom(pendingCode,currentMode);
    });
});

$('btn-back')?.addEventListener('click',()=>showOnly('lobby-menu'));

function _createRoom(mode){
    socket.emit('createRoom',{mode,playerName,team:selectedTeam,
        config:{map:selectedMap,difficulty:selectedDiff}});
}
function _joinRoom(code,mode){
    socket.emit('joinRoom',{code,mode,playerName,team:selectedTeam,
        config:{map:selectedMap,difficulty:selectedDiff}});
}

$('btn-start-game')?.addEventListener('click',()=>{
    if(isHost&&currentRoom)socket.emit('startGame',currentRoom);
});
$('btn-leave-room')?.addEventListener('click',()=>location.reload());
$('btn-copy-code')?.addEventListener('click',async()=>{
    if(!currentRoom)return;
    try{
        await navigator.clipboard.writeText(currentRoom);
        const btn=$('btn-copy-code');const orig=btn.textContent;
        btn.textContent='Copied!';setTimeout(()=>{btn.textContent=orig;},1500);
    }catch{prompt('Copy this room code:',currentRoom);}
});

socket.on('connect',()=>{
    console.log('Connected:',socket.id);
    if(window.gameEngine)window.gameEngine.setPlayerId(socket.id);
});

socket.on('roomCreated',data=>{
    currentRoom=data.code;isHost=true;
    _showRoomLobby(data.code,data.players,true);
    if(currentMode==='VS_COMPUTER'){
        setTimeout(()=>{
            socket.emit('startGame',data.code);
            const diffBots={easy:2,medium:4,hard:6};
            const count=diffBots[selectedDiff]||3;
            setTimeout(()=>window.gameEngine?.spawnAIBots?.(count,selectedDiff),1200);
        },500);
    }
});

socket.on('roomJoined',data=>{
    currentRoom=data.code;isHost=false;
    _showRoomLobby(data.code,data.players,false);
});

socket.on('playerJoined',player=>{
    _addPlayerToList(player);
    const el=$('display-room-code');
    if(el){el.style.color='#00ff88';setTimeout(()=>{el.style.color='';},400);}
});

socket.on('playerLeft',data=>{
    const id=data.id||data;
    document.getElementById('pli-'+id)?.remove();
});

socket.on('newHost',data=>{
    const id=data.id||data;
    if(id===socket.id){isHost=true;show('btn-start-game');hide('waiting-msg');}
});

socket.on('gameStarted',data=>{
    const overlay=$('menu-overlay');
    if(overlay)overlay.style.display='none';
    ['hud-radar','hud-health','hud-weapon','hud-stats'].forEach(show);
    if(/Android|iPhone|iPad/i.test(navigator.userAgent))show('mobile-controls');
    document.dispatchEvent(new Event('azoxGameStarted'));
    console.log('Game Started | Mode:',data.mode,'| Map:',data.config?.map);
});

socket.on('error',msg=>_showError(msg));

function _showRoomLobby(code,players,host){
    showOnly('room-lobby-menu');
    const codeEl=$('display-room-code');
    if(codeEl)codeEl.textContent=code;
    if(host){show('btn-start-game');hide('waiting-msg');}
    else{hide('btn-start-game');show('waiting-msg');}
    const list=$('player-list');if(list)list.innerHTML='';
    players.forEach(_addPlayerToList);
}

function _addPlayerToList(player){
    const list=$('player-list');if(!list)return;
    if(document.getElementById('pli-'+player.id))return;
    const li=document.createElement('li');li.id='pli-'+player.id;
    const isMe=player.id===socket.id;
    const teamTag=player.team?` [Team ${player.team}]`:'';
    li.innerHTML=`<span style="color:${isMe?'#ffcc00':'#888'}">${isMe?'★':'◆'}</span>
        ${player.name||player.id.substring(0,8)}${teamTag}
        ${isMe?'<small style="color:#ff2233"> (you)</small>':''}`;
    list.appendChild(li);
}

function _showError(msg){
    const t=document.createElement('div');
    t.style.cssText='position:fixed;top:20px;left:50%;transform:translateX(-50%);'+
        'background:#cc1122;color:#fff;padding:10px 22px;border-radius:8px;'+
        'font-family:Courier New,monospace;font-size:.85rem;z-index:9999;'+
        'box-shadow:0 4px 20px rgba(0,0,0,.5)';
    t.textContent='⚠ '+msg;document.body.appendChild(t);
    setTimeout(()=>t.remove(),3000);
}

$('input-room-code')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btn-join-room')?.click()});
$('input-player-name')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btn-create-room')?.click()});
$('input-room-code')?.addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').substring(0,6)});

console.log('UI Controller ready');
})();
