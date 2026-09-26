import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata={title:'explode me — Look a little closer',description:'Take things apart. Explore their pieces. Discover where they began.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'},appleWebApp:{capable:true,title:'explode me',statusBarStyle:'default'}};
export const viewport: Viewport={width:'device-width',initialScale:1,themeColor:'#f8f9f6'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
