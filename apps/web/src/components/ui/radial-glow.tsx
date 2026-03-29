import { motion } from "framer-motion";
import { heroEase } from "@/utils/constants";

const RadialGlow = () => {
  return (
    <motion.div
        className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[1200px] aspect-square bg-primary/20 rounded-full blur-[160px] opacity-70 pointer-events-none"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 0.7, scale: 1 }}
        transition={{ duration: 1, ease: heroEase, delay: 0.04 }}
      />
  )
}

export default RadialGlow