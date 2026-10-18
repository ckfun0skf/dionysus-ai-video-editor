import type { TimelineClip, TimelineTrack } from "./types";
export interface TimelineDropPosition {start:number;snapTime?:number}
const epsilon=1e-6,snapFrame=(time:number,fps:number)=>Math.round(time*fps)/fps;
export function canPlaceTimelineClipOnTrack(clip:TimelineClip,track:TimelineTrack):boolean{return clip.kind==="clip"?track.kind==="video":clip.kind===track.kind}
export function calculateTimelineDropPosition(clips:TimelineClip[],movingId:string,targetTrackId:string,desiredStart:number,duration:number,timelineDuration:number,fps:number,snapTolerance=0.18):TimelineDropPosition|null{
 if(!Number.isFinite(desiredStart)||!Number.isFinite(duration)||duration<=0||!Number.isFinite(timelineDuration)||timelineDuration<=0)return null;
 const rate=Math.max(1,Number.isFinite(fps)?fps:24);if(duration>timelineDuration+epsilon)return null;
 const maxStart=Math.max(0,Math.floor((timelineDuration-duration)*rate+epsilon)/rate),desired=snapFrame(Math.max(0,Math.min(maxStart,desiredStart)),rate);
 const others=clips.filter(c=>c.id!==movingId),destination=others.filter(c=>c.trackId===targetTrackId);
 const valid=(start:number)=>start>=-epsilon&&start<=maxStart+epsilon&&destination.every(c=>start+duration<=c.start+epsilon||start>=c.start+c.duration-epsilon);
 type Candidate={start:number;snapTime:number;distance:number;sameTrack:boolean};const near:Candidate[]=[];
 for(const c of others)for(const e of [{start:c.start,snapTime:c.start},{start:c.start+c.duration,snapTime:c.start+c.duration},{start:c.start-duration,snapTime:c.start},{start:c.start+c.duration-duration,snapTime:c.start+c.duration}]){
  const start=snapFrame(e.start,rate),distance=Math.abs(start-desired);if(distance<=snapTolerance&&start>=0&&start<=maxStart&&valid(start))near.push({start,snapTime:e.snapTime,distance,sameTrack:c.trackId===targetTrackId});
 }
 const sn=near.sort((a,b)=>a.distance-b.distance||Number(b.sameTrack)-Number(a.sameTrack))[0];if(sn)return {start:sn.start,snapTime:sn.snapTime};if(valid(desired))return {start:desired};
 const alts:Candidate[]=[];
 for(const c of destination)for(const e of [{start:c.start-duration,snapTime:c.start},{start:c.start+c.duration,snapTime:c.start+c.duration},{start:c.start+c.duration-duration,snapTime:c.start+c.duration}]){
  const start=snapFrame(e.start,rate);if(start>=0&&start<=maxStart&&valid(start))alts.push({start,snapTime:e.snapTime,distance:Math.abs(start-desired),sameTrack:true});
 }
 alts.push({start:0,snapTime:0,distance:Math.abs(desired),sameTrack:true},{start:maxStart,snapTime:maxStart+duration,distance:Math.abs(maxStart-desired),sameTrack:true});
 const best=alts.filter(c=>valid(c.start)).sort((a,b)=>a.distance-b.distance)[0];return best?{start:best.start,snapTime:best.snapTime}:null;
}