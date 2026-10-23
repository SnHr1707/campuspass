package dev.campuspass.events;

import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.annotation.CachingConfigurer;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.interceptor.CacheErrorHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Caching is enabled here, not on the application class, so web-layer test slices stay small.
@Configuration
@EnableCaching
public class AppConfig implements CachingConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AppConfig.class);

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * If Redis is down, log it and read from MongoDB instead of failing the request.
     * The cache is an optimisation, not a dependency.
     */
    @Override
    public CacheErrorHandler errorHandler() {
        return new CacheErrorHandler() {
            @Override
            public void handleCacheGetError(RuntimeException e, Cache cache, Object key) {
                log.warn("cache get failed, falling back to MongoDB: {}", e.getMessage());
            }

            @Override
            public void handleCachePutError(RuntimeException e, Cache cache, Object key, Object value) {
                log.warn("cache put failed: {}", e.getMessage());
            }

            @Override
            public void handleCacheEvictError(RuntimeException e, Cache cache, Object key) {
                log.warn("cache evict failed: {}", e.getMessage());
            }

            @Override
            public void handleCacheClearError(RuntimeException e, Cache cache) {
                log.warn("cache clear failed: {}", e.getMessage());
            }
        };
    }
}
