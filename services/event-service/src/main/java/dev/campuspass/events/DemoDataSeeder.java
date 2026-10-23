package dev.campuspass.events;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** Adds a few sample events on first start so the site never looks empty. Off unless SEED_DEMO=true. */
@Component
@ConditionalOnProperty(name = "campuspass.seed-demo", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    private final EventRepository repository;
    private final Clock clock;

    public DemoDataSeeder(EventRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (repository.count() > 0) {
            return;
        }
        Instant base = Instant.now(clock).truncatedTo(ChronoUnit.HOURS);
        List<Event> demo = List.of(
                event("Hackathon Kickoff: Build for Bharat", "24-hour hackathon. Teams of up to four. Food and mentors provided.",
                        "Seminar Hall A", "tech", base.plus(Duration.ofDays(5)).plus(Duration.ofHours(4)), 120),
                event("Navratri Garba Night", "Live dhol, food stalls and a best-dressed contest.",
                        "Open Air Theatre", "cultural", base.plus(Duration.ofDays(9)).plus(Duration.ofHours(10)), 400),
                event("Intro to Kubernetes Workshop", "Hands-on lab: deploy your first app on a real cluster.",
                        "Lab 3, CSE Block", "workshop", base.plus(Duration.ofDays(3)).plus(Duration.ofHours(2)), 40),
                event("Inter-College Cricket Final", "Nirma vs. LD College. Free entry with a ticket.",
                        "Main Ground", "sports", base.plus(Duration.ofDays(12)).plus(Duration.ofHours(3)), 300));
        repository.saveAll(demo);
        log.info("seeded {} demo events", demo.size());
    }

    private Event event(String title, String description, String venue, String category, Instant startsAt, int capacity) {
        return new Event(null, title, description, venue, category, startsAt, capacity, "seed", "CampusPass Team", Instant.now(clock));
    }
}
