import {describe,expect,it} from "vitest";
import type {TimelineClip,TimelineTrack} from "./types";
import {calculateTimelineDropPosition,canPlaceTimelineClipOnTrack} from "./timelinePlacement";
const tracks:TimelineTrack[]=[{id:"v1",name:"Video 1",kind:"video"},{id:"v2",name:"Video 2",kind:"video"},{id:"a1",name:"Audio 1",kind:"audio"}];
const clip=(id:string,trackId:string,start:number,duration:number,kind:TimelineClip["kind"]="video"):TimelineClip=>({id,trackId,start,duration,kind,name:id});
describe("timeline drop placement",()=>{
 it("snaps the actual destination to an adjacent edge and returns a guide",()=>expect(calculateTimelineDropPosition([clip("moving","v1",0,3),clip("anchor","v1",5,2)],"moving","v1",2.05,3,12,24)).toEqual({start:2,snapTime:5}));
 it("snaps to another layer and permits compatible cross-layer moves",()=>{const c=[clip("moving","v1",0,2),clip("anchor","v2",4,3)];expect(canPlaceTimelineClipOnTrack(c[0],tracks[1])).toBe(true);expect(calculateTimelineDropPosition(c,"moving","v2",2.05,2,12,24)).toEqual({start:2,snapTime:4})});
 it("never returns an overlapping target-track position",()=>{const r=calculateTimelineDropPosition([clip("moving","v1",0,3),clip("first","v2",4,3),clip("second","v2",7,2)],"moving","v2",4.2,3,12,24);expect(r).toEqual({start:1,snapTime:4});expect(r!.start+3).toBeLessThanOrEqual(4+1e-6);expect(r!.start>=9||r!.start+3<=4).toBe(true)});
 it("rejects a full target track and preserves frame alignment",()=>{expect(calculateTimelineDropPosition([clip("moving","v1",0,4),clip("full","v2",0,10)],"moving","v2",2,4,10,24)).toBeNull();const r=calculateTimelineDropPosition([clip("moving","v1",0,1)],"moving","v2",1.013,1,10,24);expect(r).toBeTruthy();expect(r!.start*24).toBeCloseTo(Math.round(r!.start*24),7)});
 it("accepts Clip Assets on video layers but rejects media-kind mismatches",()=>{expect(canPlaceTimelineClipOnTrack(clip("clip","v1",0,1,"clip"),tracks[0])).toBe(true);expect(canPlaceTimelineClipOnTrack(clip("audio","a1",0,1,"audio"),tracks[0])).toBe(false)});
});