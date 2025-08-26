(()=>{"use strict";
const $=id=>document.getElementById(id),clock=$("clock"),alarmLed=$("alarm-led"),logEl=$("log");
const v={co2:$("v-co2"),temp:$("v-temp"),hum:$("v-hum"),rpm:$("v-rpm")};
const ctl={ack:$("btn-alarm"),test:$("btn-test"),run:$("sw-run"),maint:$("sw-maint"),alarm:$("sw-alarm")};

function pad(n){return (n<10?"0":"")+n}
function tickClock(){const d=new Date();clock.textContent=`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}
setInterval(tickClock,500);tickClock();

function rand(a,b){return Math.random()*(b-a)+a}
function jiggle(){v.co2.textContent=Math.round(rand(420,1450)).toString().padStart(4,"0");
v.temp.textContent=rand(18,29).toFixed(1).padStart(4,"0");
v.hum.textContent=Math.round(rand(30,70)).toString().padStart(2,"0");
v.rpm.textContent=Math.round(rand(800,2400)).toString().padStart(4,"0");}
setInterval(jiggle,1200);jiggle();

function log(sev,msg){const row=document.createElement("div");row.className="row";
const ts=document.createElement("span");ts.className="ts";ts.textContent=new Date().toLocaleTimeString();
const s=document.createElement("span");s.className=`sev ${sev}`;s.textContent=sev;
const m=document.createElement("span");m.textContent=msg;
row.append(ts,s,m);logEl.append(row);logEl.scrollTop=logEl.scrollHeight;}

ctl.ack.onclick=()=>{alarmLed.classList.remove("on","blink","red");ctl.alarm.checked=false;log("OK","Alarm acknowledged")};
ctl.test.onclick=()=>{document.querySelectorAll(".led").forEach(el=>el.classList.add("on","green","amber","red"));
setTimeout(()=>{document.querySelectorAll(".led").forEach(el=>el.classList.remove("on","green","amber","red"));
document.querySelector(".led.green").classList.add("on","green");
document.querySelector(".led.amber").classList.add("on","amber","blink");
if(ctl.alarm.checked) alarmLed.classList.add("on","red","blink");},500);log("OK","Lamp test executed")};
ctl.run.onchange=e=>{const led=document.querySelector(".led.green");led.classList.toggle("on",e.target.checked);log(e.target.checked?"OK":"WARN",e.target.checked?"RUN switched on":"RUN switched off (local)")};
ctl.maint.onchange=e=>{const led=document.querySelector(".led.amber");led.classList.toggle("on",e.target.checked);led.classList.toggle("blink",e.target.checked);log(e.target.checked?"WARN":"OK",e.target.checked?"MAINT mode":"MAINT cleared")};
ctl.alarm.onchange=e=>{const on=e.target.checked;alarmLed.classList.toggle("on",on);alarmLed.classList.toggle("red",on);alarmLed.classList.toggle("blink",on);log(on?"ALARM":"OK",on?"Alarm condition set (demo)":"Alarm cleared")};
document.querySelector(".led.green").classList.add("on","green");
document.querySelector(".led.amber").classList.add("on","amber","blink");

/* Plotly scatter (theme-matched) */
function makeScatter(){
  const N=150,x=[],y=[];
  for(let i=0;i<N;i++){x.push(rand(-5,5)+(Math.random()<.4?2:0));y.push(rand(-3,3)+(Math.random()<.4?-1:0));}
  const data=[{x,y,mode:"markers",type:"scatter",marker:{size:6,color:"#00ff66",opacity:.85}}];
  const layout={
    margin:{l:40,r:10,t:10,b:35},
    paper_bgcolor:"#0b0f0c",
    plot_bgcolor:"#0b0f0c",
    font:{family:"MS Sans Serif, Tahoma, Arial, sans-serif",color:"#c7ffc7"},
    xaxis:{showgrid:true,gridcolor:"#113522",zeroline:false,linecolor:"#224a35",tickfont:{color:"#9bffb8"}},
    yaxis:{showgrid:true,gridcolor:"#113522",zeroline:false,linecolor:"#224a35",tickfont:{color:"#9bffb8"}},
    dragmode:"pan"
  };
  const cfg={displayModeBar:false,responsive:true};
  Plotly.newPlot("plotly-scat",data,layout,cfg);
}
if(window.Plotly){makeScatter()} else {log("WARN","Plotly failed to load");}
})();
