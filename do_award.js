const fs=require('fs');
const NL=String.fromCharCode(10);
const src=fs.readFileSync('src/app/dashboard/awards/page.tsx','utf8');
const lines=src.split(NL);
const marker="function AwardCard({ record, canEdit, onEdit, onDelete, onPreview }: {";
const si=lines.findIndex(function(l){return l===marker;});
let depth=0,ei=-1;
for(let i=si;i<lines.length;i++){for(let j=0;j<lines[i].length;j++){if(lines[i][j]==="{")depth++;else if(lines[i][j]==="}")depth--;}if(depth<=0&&i>si){ei=i;break;}}
console.log("AwardCard:",si+1,"-",ei+1);
const card=fs.readFileSync('card_content.txt','utf8').split(NL);
const result=lines.slice(0,si).concat(card).concat(lines.slice(ei+1)).join(NL);
fs.writeFileSync('src/app/dashboard/awards/page.tsx',result,'utf8');
console.log("Done! New lines:",result.split(NL).length);
