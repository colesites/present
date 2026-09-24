import { clerkMiddleware } from '@clerk/nextjs/server'

export default clerkMiddleware()

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    // And the embed pages: they are framed by the desktop app, where the
    // site's cookies are third-party and never arrive, so there is no session
    // to resolve — only a sign-in handshake that could redirect a video away.
    '/((?!_next|embed/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}