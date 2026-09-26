import * as T from 'three';
import type { Part, GeometryNode } from './model';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
const mat = (color: string, roughness = .72) => new T.MeshStandardMaterial({ color, roughness, metalness: 0 });
const sphere = new T.SphereGeometry(1, 40, 28);
function ell(g: T.Group, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) { const m = new T.Mesh(sphere, mat(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
function box(g: T.Group, color: string, w: number, h: number, d: number, x = 0, y = 0, z = 0) { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
function tube(g: T.Group, color: string, points: number[][], r = .035) { const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p as [
    number,
    number,
    number
]))); const m = new T.Mesh(new T.TubeGeometry(curve, Math.max(16, points.length * 6), r, 7, false), mat(color)); m.castShadow = true; g.add(m); return m; }
function cyl(g: T.Group, color: string, r: number, h: number, x = 0, y = 0, z = 0) { const m = new T.Mesh(new T.CylinderGeometry(r, r, h, 48), mat(color)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
let seed = 42;
function rand() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function breadShape() { const s = new T.Shape(); s.moveTo(-.97, -1); s.lineTo(.97, -1); s.quadraticCurveTo(1.1, -1, 1.1, -.83); s.lineTo(1.06, .44); s.bezierCurveTo(1.55, 1.45, -1.55, 1.45, -1.06, .44); s.lineTo(-1.1, -.83); s.quadraticCurveTo(-1.1, -1, -.97, -1); return s; }
function extrude(g: T.Group, s: T.Shape, color: string, depth: number, scale = 1, y = 0) { const geo = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .045, bevelThickness: .035, curveSegments: 24 }); geo.translate(0, 0, -depth / 2); geo.rotateX(-Math.PI / 2); const m = new T.Mesh(geo, mat(color)); m.scale.set(scale, 1, scale); m.position.y = y; m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
function toast(g: T.Group) { extrude(g, breadShape(), '#a76429', .21); extrude(g, breadShape(), '#e5ba73', .24, .92, .01); seed = 421; const geometry = new T.SphereGeometry(1, 6, 4); const m = new T.InstancedMesh(geometry, mat('#c49653'), 180); const tmp = new T.Object3D(); for (let i = 0; i < 180; i++) {
    const x = (rand() - .5) * 1.7, z = (rand() - .5) * 1.65, r = .011 + rand() * .025;
    tmp.position.set(x, .153, z);
    tmp.scale.set(r, .006, r * (.6 + rand()));
    tmp.rotation.y = rand() * 6;
    tmp.updateMatrix();
    m.setMatrixAt(i, tmp.matrix);
} g.add(m); for (let i = 0; i < 4; i++) {
    const mark = box(g, '#c08a44', 1.53, .003, .055, 0, .157, -.5 + i * .33);
    mark.rotation.y = -.14;
} }
function lettuce(g: T.Group, color: string) { const verts: number[] = [], indices: number[] = []; const rings = 12, segs = 80; for (let j = 0; j <= rings; j++) {
    let r = j / rings;
    for (let i = 0; i <= segs; i++) {
        let a = i / segs * Math.PI * 2;
        let edge = 1 + .1 * Math.sin(a * 9) + .045 * Math.sin(a * 17);
        verts.push(Math.cos(a) * r * edge * 1.15, .035 * Math.sin(a * 8 + r * 7) * r + .09 * r * r * Math.sin(a * 13), Math.sin(a) * r * edge * 1.02);
    }
} for (let j = 0; j < rings; j++)
    for (let i = 0; i < segs; i++) {
        let a = j * (segs + 1) + i, b = a + segs + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
    } const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); geo.setIndex(indices); geo.computeVertexNormals(); const material = mat(color, .82); material.side = T.DoubleSide; const m = new T.Mesh(geo, material); m.castShadow = true; m.receiveShadow = true; g.add(m); tube(g, '#b6cb72', [[0, .025, -.95], [0, .04, 0], [0, .025, .96]], .018); for (let i = -3; i <= 3; i++) {
    const z = i * .24;
    for (const sign of [-1, 1])
        tube(g, '#91b64c', [[0, .03, z], [sign * .4, .04, z + .14], [sign * .86, .03, z + .2]], .008);
} }
function tomato(g: T.Group) { cyl(g, '#c93224', .76, .12); cyl(g, '#ef6641', .712, .127); cyl(g, '#edb064', .12, .139); for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    const x = Math.sin(a) * .37, z = Math.cos(a) * .37;
    const l = ell(g, '#c94025', x, .066, z, .17, .014, .26);
    l.rotation.y = a;
    for (let j = 0; j < 4; j++) {
        const b = a + (j - 1.5) * .3;
        const r = .27 + (j % 2) * .16;
        const s = ell(g, '#edcb78', Math.sin(b) * r, .084, Math.cos(b) * r, .027, .009, .048);
        s.rotation.y = b;
    }
    tube(g, '#f49b64', [[Math.sin(a + .63) * .15, .07, Math.cos(a + .63) * .15], [Math.sin(a + .63) * .45, .07, Math.cos(a + .63) * .45], [Math.sin(a + .63) * .67, .07, Math.cos(a + .63) * .67]], .027);
} }
function bacon(g: T.Group, color: string) { const verts: number[] = [], ids: number[] = []; const n = 40; for (let i = 0; i <= n; i++) {
    const z = (i / n - .5) * 2.05;
    for (let j = 0; j < 6; j++) {
        const x = (j / 5 - .5) * .42;
        verts.push(x + .04 * Math.sin(i * .61), .048 * Math.sin(i * .52) + .025 * Math.cos(j * 2 + i * .3), z);
    }
} for (let i = 0; i < n; i++)
    for (let j = 0; j < 5; j++) {
        const a = i * 6 + j, b = a + 6;
        ids.push(a, b, a + 1, b, b + 1, a + 1);
    } const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(verts, 3)); geo.setIndex(ids); geo.computeVertexNormals(); const m = mat(color, .6); m.side = T.DoubleSide; g.add(new T.Mesh(geo, m)); for (let s = 0; s < 2; s++)
    tube(g, '#e6af84', Array.from({ length: 30 }, (_, i) => { const z = (i / 29 - .5) * 2.02; return [s === 0 ? -.11 + .025 * Math.sin(i * .7) : .07 + .03 * Math.cos(i * .8), .058 * Math.sin(i / 29 * 40 * .52) + .025, z]; }), .022); }
function heart(g: T.Group) { ell(g, '#b94350', 0, -.12, 0, .52, .66, .4).rotation.z = -.3; ell(g, '#bd5261', -.29, .36, 0, .3, .3, .3); ell(g, '#a6424f', .3, .3, -.05, .26, .25, .27); tube(g, '#af3547', [[.1, .25, 0], [.08, .75, 0], [.36, .98, 0], [.56, .77, 0]], .11); tube(g, '#73879d', [[-.18, .27, .1], [-.27, .7, .11], [-.56, .87, .06]], .1); tube(g, '#ddb594', [[.05, .48, .38], [-.11, .17, .38], [-.17, -.22, .33], [-.03, -.7, .05]], .014); for (let i = 0; i < 4; i++)
    tube(g, '#dd8b83', [[-.08, .22 - i * .15, .39], [.16, .18 - i * .18, .34], [.3, -i * .19, .23]], .012); }
function bone(g: T.Group, a: number[], b: number[], r = .07) { tube(g, '#e5d8bb', [a, b], r); for (const p of [a, b]) {
    ell(g, '#e6dbc3', p[0] - .04, p[1], p[2], r * 1.5, r * 1.1, r * 1.5);
    ell(g, '#e6dbc3', p[0] + .04, p[1], p[2], r * 1.5, r * 1.1, r * 1.5);
} }
function skull(g: T.Group, dog = false) { ell(g, '#e5d9c0', 0, .23, -.05, .5, .62, .45); ell(g, '#e5d9c0', 0, -.25, .16, .35, .34, .3); for (const s of [-1, 1]) {
    ell(g, '#71695b', s * .21, .07, .36, .14, .14, .048);
    ell(g, '#e8ddc7', s * .31, -.1, .29, .14, .08, .09);
} ell(g, '#897c66', 0, -.16, .41, .085, .12, .035); for (let i = 0; i < 8; i++)
    box(g, '#f3eada', .05, .11, .08, (i - 3.5) * .06, -.43, .32); if (dog)
    ell(g, '#e6d8be', 0, -.2, .55, .23, .2, .5); }
function createReferencePart(part: Part): T.Group {
    const g = new T.Group();
    seed = 41;
    const c = part.color;
    switch (part.shape) {
        case 'bread':
            toast(g);
            break;
        case 'spread':
            extrude(g, breadShape(), c, .036, .86);
            break;
        case 'lettuce':
            lettuce(g, c);
            break;
        case 'tomato':
            tomato(g);
            break;
        case 'bacon':
            bacon(g, c);
            break;
        case 'heart':
            heart(g);
            break;
        case 'organ':
            ell(g, c, 0, 0, 0, .7, .55, .48);
            break;
        case 'vessel':
            tube(g, c, [[-.4, -.5, 0], [-.4, .45, 0], [0, .8, 0], [.4, .45, 0], [.4, .1, 0]], .15);
            break;
        case 'valves':
            for (let i = 0; i < 4; i++) {
                const ring = new T.Mesh(new T.TorusGeometry(.21, .035, 8, 30), mat(c));
                ring.position.set(i % 2 * .6 - .3, Math.floor(i / 2) * .6 - .3, 0);
                g.add(ring);
                for (let j = 0; j < 3; j++)
                    ell(g, c, ring.position.x + Math.cos(j * 2.09) * .1, ring.position.y + Math.sin(j * 2.09) * .1, 0, .12, .08, .026);
            }
            break;
        case 'skull':
            skull(g);
            break;
        case 'dogskull':
            skull(g, true);
            g.rotation.y = -Math.PI / 2;
            break;
        case 'ribs':
            for (let i = 0; i < 8; i++) {
                const y = .7 - i * .18, w = .48 + Math.sin(i / 8 * Math.PI) * .18;
                for (const s of [-1, 1])
                    tube(g, c, [[0, y, -.32], [s * w, y + .05, -.15], [s * w, y - .03, .25], [s * .1, y - .15, .43]], .034);
            }
            bone(g, [0, .7, .42], [0, -.7, .36], .055);
            break;
        case 'spine':
            for (let i = 0; i < 13; i++) {
                ell(g, c, 0, .8 - i * .135, Math.sin(i * .25) * .09, .12, .065, .1);
                box(g, c, .055, .08, .18, 0, .8 - i * .135, -.13);
            }
            break;
        case 'lungs':
            for (const s of [-1, 1])
                ell(g, c, s * .4, 0, 0, .34, .65, .28).rotation.z = s * .14;
            tube(g, '#e1c3b4', [[0, .9, 0], [0, .3, .13], [-.25, 0, .2]], .055);
            tube(g, '#e1c3b4', [[0, .3, .13], [.25, 0, .2]], .05);
            break;
        case 'intestine':
            tube(g, c, Array.from({ length: 60 }, (_, i) => [Math.sin(i * .48) * .42, Math.cos(i * .48) * .11 + .4 - i * .014, .1 * Math.sin(i * .8)]), .085);
            break;
        case 'pelvis':
            for (const s of [-1, 1])
                ell(g, c, s * .3, 0, 0, .35, .3, .18).rotation.z = s * .3;
            break;
        case 'arms':
            for (const s of [-1, 1]) {
                bone(g, [s * .8, .65, 0], [s * 1, -.05, .03]);
                bone(g, [s * 1, -.05, .03], [s * 1.04, -.8, .08], .05);
            }
            break;
        case 'legs':
            for (const s of [-1, 1]) {
                bone(g, [s * .32, .85, 0], [s * .35, 0, .03], .09);
                bone(g, [s * .35, 0, .03], [s * .36, -.9, 0], .07);
                ell(g, c, s * .36, -.94, .18, .12, .08, .28);
            }
            break;
        case 'shirt':
            box(g, c, 1.55, 1.6, .65);
            for (const s of [-1, 1]) {
                const m = box(g, c, .55, .6, .65, s * .91, .51, 0);
                m.rotation.z = s * -.25;
            }
            break;
        case 'pants':
            for (const s of [-1, 1])
                box(g, c, .6, 2.3, .54, s * .32, -.1, 0);
            box(g, c, 1.2, .44, .6, 0, 1, 0);
            break;
        case 'head':
            ell(g, c, 0, .2, 0, .56, .77, .46);
            ell(g, c, 0, -.36, .12, .37, .36, .35);
            ell(g, c, 0, -.04, .46, .09, .17, .12);
            for (const s of [-1, 1])
                ell(g, c, s * .55, .06, 0, .1, .2, .11);
            break;
        case 'brain':
            for (const s of [-1, 1]) {
                ell(g, c, s * .24, 0, 0, .3, .39, .45);
                for (let i = 0; i < 8; i++)
                    tube(g, '#aa7880', Array.from({ length: 12 }, (_, j) => [s * (.13 + .3 * Math.sin(j / 11 * Math.PI)), .33 * Math.cos(j / 11 * Math.PI), -.34 + i * .095]), .021);
            }
            break;
        case 'eyes':
            for (const s of [-1, 1]) {
                ell(g, c, s * .23, 0, 0, .17, .17, .17);
                ell(g, '#537b75', s * .23, 0, .151, .082, .082, .035);
                ell(g, '#273633', s * .23, 0, .179, .04, .04, .012);
            }
            break;
        case 'jaw':
            tube(g, c, [[-.37, .2, -.1], [-.32, -.1, .17], [0, -.24, .32], [.32, -.1, .17], [.37, .2, -.1]], .08);
            break;
        case 'hand':
            ell(g, c, 0, 0, 0, .48, .6, .13);
            for (let i = 0; i < 4; i++) {
                const len = .65 + Math.sin(i / 3 * Math.PI) * .2;
                tube(g, c, [[(i - 1.5) * .24, .3, 0], [(i - 1.5) * .27, .7, 0], [(i - 1.5) * .28, .45 + len, 0]], .09);
            }
            tube(g, c, [[-.4, -.25, 0], [-.66, .02, .03], [-.75, .29, .06]], .12);
            break;
        case 'carpals':
            for (let i = 0; i < 8; i++)
                ell(g, c, (i % 4 - 1.5) * .19, Math.floor(i / 4) * .2, 0, .1, .1, .08);
            break;
        case 'metacarpals':
            for (let i = 0; i < 5; i++)
                bone(g, [(i - 2) * .16, -.3, 0], [(i - 2) * .22, .35, 0], .044);
            break;
        case 'fingers':
            for (let i = 0; i < 5; i++)
                for (let j = 0; j < (i === 0 ? 2 : 3); j++)
                    bone(g, [(i - 2) * .24, j * .26, 0], [(i - 2) * .24, j * .26 + .22, 0], .038);
            break;
        case 'tendons':
            for (let i = 0; i < 5; i++)
                tube(g, c, [[0, -.9, 0], [(i - 2) * .1, -.2, 0], [(i - 2) * .25, .7, 0]], .018);
            break;
        case 'dog':
            ell(g, c, 0, 0, 0, 1.3, .56, .42);
            ell(g, c, -1.1, .45, 0, .5, .69, .4);
            ell(g, c, -1.35, .86, 0, .43, .44, .35);
            ell(g, c, -1.69, .7, 0, .36, .21, .23);
            ell(g, '#3f352b', -1.98, .73, 0, .08, .12, .16);
            for (const s of [-1, 1]) {
                ell(g, '#b88c48', -1.19, .57, s * .34, .18, .4, .11);
                ell(g, '#302d27', -1.54, .94, s * .275, .04, .045, .025);
                for (const x of [-.85, .85]) {
                    ell(g, c, x, -.67, s * .3, .17, .6, .15);
                    ell(g, c, x - .13, -1.22, s * .3, .26, .12, .18);
                }
            }
            tube(g, c, [[1.05, .17, 0], [1.63, .24, 0], [1.9, .75, .03], [1.86, 1, .05]], .13);
            break;
        case 'doglegs':
            for (const x of [-.85, .85])
                for (const s of [-1, 1]) {
                    bone(g, [x, .6, s * .3], [x + .1, 0, s * .3], .065);
                    bone(g, [x + .1, 0, s * .3], [x, -.5, s * .3], .055);
                }
            break;
        case 'petals':
            for (let i = 0; i < 24; i++) {
                const a = i / 24 * Math.PI * 2;
                const m = ell(g, c, Math.cos(a) * .99, Math.sin(a) * .99, 0, .16, .48, .05);
                m.rotation.z = a - Math.PI / 2;
            }
            break;
        case 'disk':
            ell(g, c, 0, 0, 0, .72, .72, .16);
            for (let i = 0; i < 190; i++) {
                const a = i * 2.39996, r = Math.sqrt(i / 190) * .68;
                ell(g, i % 3 === 0 ? '#af8b37' : '#765324', Math.cos(a) * r, Math.sin(a) * r, .14, .027, .027, .034);
            }
            break;
        case 'seeds':
            for (let i = 0; i < 90; i++) {
                const a = i * 2.39996, r = Math.sqrt(i / 90) * .65;
                ell(g, c, Math.cos(a) * r, Math.sin(a) * r, 0, .033, .054, .025).rotation.z = a;
            }
            break;
        case 'stem':
            tube(g, c, [[0, -1.35, 0], [.08, -.6, 0], [0, .3, 0], [0, 1.4, 0]], .062);
            break;
        case 'leaf':
            lettuce(g, c);
            g.scale.set(.62, .62, .9);
            g.rotation.x = .65;
            break;
        case 'roots':
            for (let i = 0; i < 12; i++) {
                const a = i * 2.4;
                tube(g, c, [[0, .3, 0], [Math.cos(a) * .2, 0, Math.sin(a) * .2], [Math.cos(a) * .55, -.45, Math.sin(a) * .45], [Math.cos(a) * .7, -.8, Math.sin(a) * .6]], .018);
            }
            break;
        case 'brick':
            box(g, c, 1.08, .43, .55);
            for (let x = 0; x < 4; x++)
                for (let z = 0; z < 2; z++)
                    cyl(g, c, .095, .085, (x - 1.5) * .265, .256, (z - .5) * .265);
            break;
        default: ell(g, c, 0, 0, 0, .5, .5, .5);
    }
    const wrapper = new T.Group();
    wrapper.add(g);
    if (part.scale)
        wrapper.scale.set(...part.scale);
    if (part.rotation)
        wrapper.rotation.set(...part.rotation);
    wrapper.userData.part = part;
    wrapper.traverse(o => { if (o instanceof T.Mesh)
        o.userData.part = part; });
    return wrapper;
}
export function disposeObject(root: T.Object3D) { const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(); root.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Line) {
    if (o.geometry !== sphere)
        geometries.add(o.geometry);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m: T.Material) => materials.add(m));
} }); geometries.forEach(x => x.dispose()); materials.forEach(x => x.dispose()); }

const textureCache=new Map<string,T.DataTexture>();
function surfaceTexture(surface:string){
 if(textureCache.has(surface))return textureCache.get(surface)!;
 const size=128,data=new Uint8Array(size*size*4);let n=137;const rnd=()=>{n=(n*1664525+1013904223)>>>0;return n/4294967296};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const noise=rnd(),u=x/size,v=y/size;let f=.55+noise*.18;
 if(surface==='porous')f=noise>.89?.08:.62+noise*.15;
 if(surface==='fibrous'||surface==='grain')f=.5+.18*Math.sin(u*190+Math.sin(v*14)*2)+noise*.18;
 if(surface==='veined')f=.45+.24*Math.cos((u+Math.sin(v*14)*.015)*105)+noise*.12;
 if(surface==='skin')f=.62+noise*.2+(noise>.97?-.4:0);
 if(surface==='speckled')f=noise>.93?.2:.68+noise*.17;
 const i=(y*size+x)*4;data[i]=data[i+1]=data[i+2]=Math.floor(T.MathUtils.clamp(f,0,1)*255);data[i+3]=255;}
 const tex=new T.DataTexture(data,size,size,T.RGBAFormat);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(3,3);tex.needsUpdate=true;textureCache.set(surface,tex);return tex;
}
function richMaterial(node:GeometryNode){const m=new T.MeshStandardMaterial({color:node.color,roughness:node.roughness,metalness:node.surface==='metal'?.72:0,side:T.DoubleSide});if(node.surface!=='smooth'&&node.surface!=='metal'){m.bumpMap=surfaceTexture(node.surface);m.bumpScale=node.surface==='porous'?.026:node.surface==='skin'?.008:.013;}return m;}
function bladeGeometry(petal:boolean){const segments=38,widths=14,verts:number[]=[],uv:number[]=[],colors:number[]=[],idx:number[]=[];
 for(let i=0;i<=segments;i++){const t=i/segments;const width=Math.pow(Math.sin(Math.PI*t),petal?.7:.9)*(petal?.22:.38)*(petal?1:.88+.12*Math.sin(t*42));for(let j=0;j<=widths;j++){const q=j/widths*2-1,x=q*width,y=t-.5;const fold=.055*(1-q*q)*Math.sin(t*Math.PI),curl=.14*Math.pow(t,3)+.012*Math.sin(t*50)*Math.pow(Math.abs(q),3);verts.push(x,y,fold+curl);uv.push(j/widths,t);const variation=.85+.15*Math.cos(q*11+t*16);colors.push(variation,variation,petal?variation*.91:variation);}}
 for(let i=0;i<segments;i++)for(let j=0;j<widths;j++){const a=i*(widths+1)+j,b=a+widths+1;idx.push(a,b,a+1,b,b+1,a+1)}const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(verts,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
function createNode(node:GeometryNode):T.Group{
 const g=new T.Group();let geo:T.BufferGeometry|undefined;const material=richMaterial(node);
 switch(node.kind){
 case 'box':geo=new RoundedBoxGeometry(1,1,1,4,.055);break;
 case 'sphere':geo=new T.SphereGeometry(.5,40,28);break;
 case 'cylinder':geo=new T.CylinderGeometry(.5,.5,1,48,4);break;
 case 'torus':geo=new T.TorusGeometry(.45,node.radius??.1,16,64);break;
 case 'lathe':geo=new T.LatheGeometry((node.profile??[[.3,-.5],[.5,-.3],[.4,.3],[.15,.5]]).map(p=>new T.Vector2(...p)),64);break;
 case 'tube':geo=new T.TubeGeometry(new T.CatmullRomCurve3((node.path??[[0,-.5,0],[.1,0,0],[0,.5,0]]).map(p=>new T.Vector3(...p))),64,node.radius??.04,12,false);break;
 case 'extrusion':{const shape=new T.Shape((node.outline??[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]).map(p=>new T.Vector2(...p)));geo=new T.ExtrudeGeometry(shape,{depth:node.depth??.1,bevelEnabled:true,bevelSize:.016,bevelThickness:.015,bevelSegments:3,curveSegments:24});geo.translate(0,0,-(node.depth??.1)/2);break;}
 case 'leaf':case 'petal':{geo=bladeGeometry(node.kind==='petal');material.vertexColors=true;const vein=new T.Color(node.color).lerp(new T.Color(node.kind==='petal'?'#c28828':'#b4c97b'),.32).getStyle();tube(g,vein,[[0,-.49,.005],[0,0,.06],[0,.46,.13]],.004);if(node.kind==='leaf')for(let i=0;i<7;i++){const y=i*.105-.35,width=Math.sin((y+.5)*Math.PI)*.33;for(const s of [-1,1])tube(g,vein,[[0,y,.06],[s*width*.6,y+.04,.04],[s*width,y+.07,.025]],.0025)}break;}
 case 'seed':{geo=new T.SphereGeometry(1,24,18);geo.scale(.034,.1,.029);const p=geo.getAttribute('position');for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)*(1-.4*Math.pow((y+.1)/.2,2)));}geo.computeVertexNormals();break;}
 case 'floret':{cyl(g,node.color,.026,.1);for(let i=0;i<5;i++){const a=i/5*Math.PI*2;const petal=ell(g,node.color,Math.cos(a)*.023,.055,Math.sin(a)*.023,.012,.022,.015);petal.rotation.z=Math.cos(a)*.3;}tube(g,'#bd8b38',[[0,.035,0],[.008,.105,0],[.014,.125,0]],.004);break;}
 case 'bone':bone(g,[0,-.5,0],[0,.5,0],.06);break;
 case 'root':tube(g,node.color,[[0,.5,0],[.04,.1,0],[.15,-.3,.07],[.2,-.6,.1]],.025);for(let i=0;i<5;i++)tube(g,node.color,[[.02,.3-i*.14,0],[(i%2?1:-1)*.2,.15-i*.17,.03],[(i%2?1:-1)*.26,.08-i*.17,.04]],.007);break;
 default:{const reference=createReferencePart({id:'node',shape:node.kind,color:node.color,pos:[0,0,0]} as Part);g.add(reference);reference.traverse(o=>{if(o instanceof T.Mesh){const m=o.material as T.MeshStandardMaterial;if(node.surface!=='smooth'&&m.isMeshStandardMaterial){m.bumpMap=surfaceTexture(node.surface);m.bumpScale=.008;}}});}
 }
 if(geo){const mesh=new T.Mesh(geo,material);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh)}else material.dispose();
 g.position.set(...node.position);g.rotation.set(...node.rotation);g.scale.set(...node.scale);return g;
}
export function createPart(part:Part):T.Group{if(!part.nodes)return createReferencePart(part);const root=new T.Group();for(const node of part.nodes)root.add(createNode(node));if(part.rotation)root.rotation.set(...part.rotation);if(part.scale)root.scale.set(...part.scale);root.userData.part=part;root.traverse(o=>{if(o instanceof T.Mesh)o.userData.part=part});return root;}
